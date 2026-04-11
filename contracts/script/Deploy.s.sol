// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std-1.15.0/src/Script.sol";
import {HederaStreamChannel} from "../src/HederaStreamChannel.sol";

/**
 * @notice Deployment script for HederaStreamChannel.
 *
 * Usage (testnet):
 *   export ABSTRACT_TESTNET_RPC=https://api.testnet.abs.xyz
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   forge script script/Deploy.s.sol \
 *     --rpc-url abstract_testnet \
 *     --broadcast \
 *     --private-key $DEPLOYER_PRIVATE_KEY
 *
 * For zksolc (required for actual Abstract deployment):
 *   See README.md — requires foundry-zksync or hardhat-zksync toolchain.
 *
 * Verification (via abscan):
 *   forge verify-contract <ADDRESS> HederaStreamChannel \
 *     --rpc-url abstract_testnet \
 *     --etherscan-api-key $ABSCAN_API_KEY
 */
contract DeployHederaStreamChannel is Script {
    function run() external {
        console2.log("Deployer:", msg.sender);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast();

        HederaStreamChannel escrow = new HederaStreamChannel{salt: bytes32(0)}();
        console2.log("HederaStreamChannel deployed:", address(escrow));
        console2.log("VOUCHER_TYPEHASH:", vm.toString(escrow.VOUCHER_TYPEHASH()));
        console2.log("Domain Separator:", vm.toString(escrow.domainSeparator()));

        vm.stopBroadcast();
    }
}
