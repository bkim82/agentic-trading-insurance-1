// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentInsurancePool} from "../src/AgentInsurancePool.sol";

/// Usage:
///   TOKEN=<erc20 address> MIN_STAKE=100000000 \
///   forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast --account <keystore-name>
///
/// MIN_STAKE is in token base units (100000000 = 100 USDC with 6 decimals).
contract Deploy is Script {
    function run() external returns (AgentInsurancePool pool) {
        address token = vm.envAddress("TOKEN");
        uint256 minStake = vm.envOr("MIN_STAKE", uint256(100e6));

        vm.startBroadcast();
        pool = new AgentInsurancePool(IERC20(token), minStake);
        vm.stopBroadcast();

        console.log("AgentInsurancePool deployed at", address(pool));
    }
}
