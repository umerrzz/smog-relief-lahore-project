// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";

/// @notice Receives Lahore AQI reports from a Chainlink CRE workflow.
/// Testnet proof of concept. Not audited.
contract AirQualityOracle is ReceiverTemplate {
    uint256 public aqi;
    uint256 public updatedAt;

    event AqiUpdated(uint256 aqi, uint256 updatedAt);

    constructor(address forwarder) ReceiverTemplate(forwarder) {}

    function _processReport(bytes calldata report) internal override {
        uint256 newAqi = abi.decode(report, (uint256));
        require(newAqi <= 1000, "AQI out of range");
        aqi = newAqi;
        updatedAt = block.timestamp;
        emit AqiUpdated(newAqi, block.timestamp);
    }

    /// @notice Same shape as MockAirQualityOracle, so the pool needs no changes.
    function latestAqi() external view returns (uint256, uint256) {
        return (aqi, updatedAt);
    }
}