// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts@5.0.2/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts@5.0.2/utils/introspection/IERC165.sol";

interface IReceiver is IERC165 {
    function onReport(
        bytes calldata metadata,
        bytes calldata report
    ) external;
}

/// @notice Minimal CRE receiver for a testnet proof of concept.
abstract contract ReceiverTemplate is IReceiver, Ownable {
    address public forwarderAddress;

    error InvalidForwarder();
    error UnauthorizedForwarder(address caller);

    event ForwarderUpdated(address indexed forwarder);

    constructor(address forwarder) Ownable(msg.sender) {
        _setForwarder(forwarder);
    }

    function setForwarderAddress(address forwarder) external onlyOwner {
        _setForwarder(forwarder);
    }

    function _setForwarder(address forwarder) private {
        if (forwarder == address(0)) revert InvalidForwarder();

        forwarderAddress = forwarder;
        emit ForwarderUpdated(forwarder);
    }

    function onReport(
        bytes calldata,
        bytes calldata report
    ) external override {
        if (msg.sender != forwarderAddress) {
            revert UnauthorizedForwarder(msg.sender);
        }

        _processReport(report);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) external pure override returns (bool) {
        return
            interfaceId == type(IReceiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    function _processReport(bytes calldata report) internal virtual;
}