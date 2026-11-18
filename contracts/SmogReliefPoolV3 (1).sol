// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts@5.0.2/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts@5.0.2/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts@5.0.2/utils/ReentrancyGuard.sol";

interface IAirQualityOracle {
    function latestAqi()
        external
        view
        returns (uint256 aqi, uint256 updatedAt);
}

interface IPriceFeed {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/// @notice Testnet proof of concept. Not audited, not for real funds.
/// @dev USD credit uses 6 decimals: $5 = 5_000_000.
/// Allows one successful trigger per Lahore calendar day.
/// Claims can be made later in either supported token.
contract SmogReliefPoolV4 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IERC20 public immutable link;
    IPriceFeed public immutable linkUsdFeed;

    uint256 public immutable priceScale;

    // Lahore uses UTC+5.
    uint256 public constant LAHORE_OFFSET = 5 hours;

    IAirQualityOracle public oracle;

    uint256 public aqiThreshold;
    uint256 public payoutUsd;
    uint256 public maxWorkers;
    uint256 public maxReadingAge;
    uint256 public maxPriceAge;

    address[] public workers;

    mapping(address => bool) public isRegistered;
    mapping(address => uint256) public owedUsd;

    // Each successful trigger consumes one Lahore calendar day.
    mapping(uint256 => bool) public payoutDayUsed;

    uint256 public totalOwedUsd;
    uint256 public lastReadingUsed;

    event Deposited(
        address indexed donor,
        address indexed token,
        uint256 amount
    );

    event Registered(address indexed worker);

    event Triggered(
        uint256 aqi,
        uint256 workersCredited,
        uint256 totalCreditedUsd,
        uint256 indexed lahoreDay
    );

    event Claimed(
        address indexed worker,
        address indexed token,
        uint256 usdAmount,
        uint256 tokenAmount
    );

    constructor(
        address _usdc,
        address _link,
        address _linkUsdFeed,
        address _oracle,
        uint256 _aqiThreshold,
        uint256 _payoutUsd,
        uint256 _maxWorkers,
        uint256 _maxReadingAge,
        uint256 _maxPriceAge
    ) Ownable(msg.sender) {
        require(
            _usdc != address(0) &&
            _link != address(0) &&
            _linkUsdFeed != address(0) &&
            _oracle != address(0),
            "Zero address"
        );

        require(_usdc != _link, "Tokens must differ");
        require(_payoutUsd > 0, "Zero payout");
        require(_maxWorkers > 0, "Zero workers");
        require(_maxReadingAge > 0, "Zero reading age");
        require(_maxPriceAge > 0, "Zero price age");

        require(
            IERC20Metadata(_usdc).decimals() == 6,
            "USDC must have 6 decimals"
        );

        require(
            IERC20Metadata(_link).decimals() == 18,
            "LINK must have 18 decimals"
        );

        uint256 feedDecimals = uint256(
            IPriceFeed(_linkUsdFeed).decimals()
        );

        require(feedDecimals <= 65, "Feed decimals too large");

        usdc = IERC20(_usdc);
        link = IERC20(_link);
        linkUsdFeed = IPriceFeed(_linkUsdFeed);

        priceScale = 10 ** (12 + feedDecimals);

        oracle = IAirQualityOracle(_oracle);

        aqiThreshold = _aqiThreshold;
        payoutUsd = _payoutUsd;
        maxWorkers = _maxWorkers;
        maxReadingAge = _maxReadingAge;
        maxPriceAge = _maxPriceAge;
    }

    // ---- Donors ----

    function deposit(
        address token,
        uint256 amount
    ) external nonReentrant {
        require(_isSupported(token), "Unsupported token");
        require(amount > 0, "Zero amount");

        IERC20(token).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );

        emit Deposited(msg.sender, token, amount);
    }

    // ---- Workers ----

    function register() external {
        require(!isRegistered[msg.sender], "Already registered");
        require(workers.length < maxWorkers, "Cohort full");

        isRegistered[msg.sender] = true;
        workers.push(msg.sender);

        emit Registered(msg.sender);
    }

    // ---- Trigger ----

    function trigger() external nonReentrant {
        uint256 day = currentLahoreDay();

        require(
            !payoutDayUsed[day],
            "Payout already triggered today"
        );

        (uint256 aqi, uint256 updatedAt) = oracle.latestAqi();

        require(
            updatedAt > 0 && updatedAt <= block.timestamp,
            "Invalid reading timestamp"
        );

        require(
            updatedAt > lastReadingUsed,
            "Reading already used"
        );

        require(
            block.timestamp - updatedAt <= maxReadingAge,
            "Stale reading"
        );

        require(aqi > aqiThreshold, "AQI not above threshold");

        uint256 n = workers.length;
        require(n > 0, "No workers");

        uint256 needed = n * payoutUsd;

        require(
            availableFundsUsd() >= totalOwedUsd + needed,
            "Pool underfunded"
        );

        // These changes revert if anything later fails.
        payoutDayUsed[day] = true;
        lastReadingUsed = updatedAt;

        for (uint256 i = 0; i < n; i++) {
            owedUsd[workers[i]] += payoutUsd;
        }

        totalOwedUsd += needed;

        emit Triggered(aqi, n, needed, day);
    }

    // ---- Claims ----

    function claim(address token) external nonReentrant {
        require(_isSupported(token), "Unsupported token");

        uint256 usd = owedUsd[msg.sender];
        require(usd > 0, "Nothing to claim");

        uint256 amount = _usdToToken(token, usd);
        require(amount > 0, "Claim rounds to zero");

        require(
            IERC20(token).balanceOf(address(this)) >= amount,
            "Insufficient chosen token"
        );

        owedUsd[msg.sender] = 0;
        totalOwedUsd -= usd;

        IERC20(token).safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, token, usd, amount);
    }

    // ---- Views ----

    function workerCount() external view returns (uint256) {
        return workers.length;
    }

    function currentLahoreDay() public view returns (uint256) {
        return (block.timestamp + LAHORE_OFFSET) / 1 days;
    }

    function triggeredToday() external view returns (bool) {
        return payoutDayUsed[currentLahoreDay()];
    }

    /// @notice Gross pool value, including assets backing owed credits.
    /// @dev Name retained from V2; this does not subtract totalOwedUsd.
    function availableFundsUsd() public view returns (uint256) {
        uint256 linkBal = link.balanceOf(address(this));

        uint256 linkValue = linkBal == 0
            ? 0
            : (linkBal * _price()) / priceScale;

        return usdc.balanceOf(address(this)) + linkValue;
    }

    /// @notice Pool value remaining after outstanding USD credits.
    function unallocatedFundsUsd() external view returns (uint256) {
        uint256 value = availableFundsUsd();

        return value > totalOwedUsd
            ? value - totalOwedUsd
            : 0;
    }

    function previewClaim(
        address worker,
        address token
    ) external view returns (uint256) {
        require(_isSupported(token), "Unsupported token");

        uint256 usd = owedUsd[worker];

        return usd == 0 ? 0 : _usdToToken(token, usd);
    }

    function currentLinkPrice() external view returns (uint256) {
        return _price();
    }

    // ---- Internal ----

    function _isSupported(address token) internal view returns (bool) {
        return token == address(usdc) || token == address(link);
    }

    function _price() internal view returns (uint256) {
        (
            ,
            int256 answer,
            ,
            uint256 updatedAt,

        ) = linkUsdFeed.latestRoundData();

        require(answer > 0, "Bad price");

        require(
            updatedAt > 0 && updatedAt <= block.timestamp,
            "Invalid price timestamp"
        );

        require(
            block.timestamp - updatedAt <= maxPriceAge,
            "Stale price"
        );

        return uint256(answer);
    }

    function _usdToToken(
        address token,
        uint256 usd
    ) internal view returns (uint256) {
        if (token == address(usdc)) {
            return usd;
        }

        if (token == address(link)) {
            return (usd * priceScale) / _price();
        }

        revert("Unsupported token");
    }

    // ---- Admin ----

    function setThreshold(uint256 value) external onlyOwner {
        aqiThreshold = value;
    }

    function setPayout(uint256 value) external onlyOwner {
        require(value > 0, "Zero payout");
        payoutUsd = value;
    }

    function setOracle(address oracleAddress) external onlyOwner {
        require(oracleAddress != address(0), "Zero oracle");
        oracle = IAirQualityOracle(oracleAddress);
    }

    function setMaxReadingAge(uint256 value) external onlyOwner {
        require(value > 0, "Zero reading age");
        maxReadingAge = value;
    }

    function setMaxPriceAge(uint256 value) external onlyOwner {
        require(value > 0, "Zero price age");
        maxPriceAge = value;
    }

    function setMaxWorkers(uint256 value) external onlyOwner {
        require(value >= workers.length, "Below current workers");
        maxWorkers = value;
    }
}