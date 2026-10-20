// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PHOOD} from "../src/PHOOD.sol";
import {PhoodIDO} from "../src/PhoodIDO.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

interface DeployVm {
    function envAddress(string calldata) external returns (address);
    function envUint(string calldata) external returns (uint256);
    function envBytes32(string calldata) external returns (bytes32);
    function startBroadcast() external;
    function stopBroadcast() external;
    function getCode(string calldata artifact) external returns (bytes memory);
}

/// @dev Use a Foundry keystore account. No private keys in this script or .env.
contract DeployBase {
    DeployVm internal constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function _checkChain() internal view {
        require(block.chainid == 46630 || block.chainid == 31337, "Testnet/local deployment only");
    }

    function _timestamp(string memory name) internal returns (uint64) {
        uint256 value = vm.envUint(name);
        return SafeCast.toUint64(value);
    }
}

/// @notice Deploy independently; the IDO does not need a token address to accept subscriptions.
contract DeployPHOOD is DeployBase {
    function run() external returns (PHOOD token) {
        _checkChain();
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 supply = vm.envUint("PHOOD_TOTAL_SUPPLY_UNITS");
        vm.startBroadcast();
        token = new PHOOD(treasury, supply);
        vm.stopBroadcast();
    }
}

contract DeployIDO is DeployBase {
    function run() external returns (PhoodIDO ido) {
        _checkChain();
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address signer = vm.envAddress("SIGNER_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        IERC20Metadata payment = IERC20Metadata(vm.envAddress("PAYMENT_TOKEN_ADDRESS"));
        bytes32 campaign = vm.envBytes32("CAMPAIGN_ID");
        PhoodIDO.Sale memory config = PhoodIDO.Sale({
            start: _timestamp("SALE_START"),
            end: _timestamp("SALE_END"),
            softCapCents: vm.envUint("SOFT_CAP_CENTS"),
            hardCapCents: vm.envUint("HARD_CAP_CENTS"),
            tokenUnitsPerDollar: vm.envUint("TOKEN_UNITS_PER_DOLLAR"),
            saleAllocation: vm.envUint("IDO_ALLOCATION_UNITS"),
            promisedSupply: vm.envUint("PHOOD_TOTAL_SUPPLY_UNITS")
        });
        bytes memory creation = abi.encodePacked(
            vm.getCode("PhoodIDO.sol:PhoodIDO"), abi.encode(admin, signer, treasury, payment, campaign, config)
        );
        vm.startBroadcast();
        address deployed;
        assembly ("memory-safe") { deployed := create(0, add(creation, 32), mload(creation)) }
        require(deployed != address(0), "IDO deployment failed");
        ido = PhoodIDO(deployed);
        vm.stopBroadcast();
    }
}
