// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {PhoodIDOTest} from "./PhoodIDO.t.sol";
import {PhoodIDO} from "../src/PhoodIDO.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface MigrationVm {
    function mockCallRevert(address callee, bytes calldata data, bytes calldata revertData) external;
    function clearMockedCalls() external;
}

contract MigrationTest is PhoodIDOTest {
    function testActivationFailureRollsBackAllFundsAndSourceClosure() public {
        _settle(10_000, 2000);
        PhoodIDO next = _prepare();
        next.importNextBatch(1);
        uint256 paymentBefore = usdt.balanceOf(address(ido));
        uint256 tokensBefore = token.balanceOf(address(ido));
        MigrationVm(address(vm))
            .mockCallRevert(
                address(next),
                abi.encodeWithSelector(PhoodIDO.completeMigration.selector),
                abi.encodeWithSignature("Error(string)", "Activation failed")
            );
        vm.expectRevert();
        ido.executeMigration();
        require(!ido.migrated() && ido.frozen() && next.importing());
        require(usdt.balanceOf(address(ido)) == paymentBefore && token.balanceOf(address(ido)) == tokensBefore);
        require(usdt.balanceOf(address(next)) == 0 && token.balanceOf(address(next)) == 0);
        MigrationVm(address(vm)).clearMockedCalls();
        ido.executeMigration();
        require(ido.migrated());
    }

    function testFrozenRefundAndSubscriptionCannotChangeSnapshot() public {
        vm.warp(1100);
        _buy(ALICE, USER, 10_000);
        PhoodIDO.Eligibility memory e = _credential(ALICE, USER);
        bytes memory sig = _signature(e);
        ido.emergencyFreeze("Pause all");
        vm.expectRevert();
        vm.prank(ALICE);
        ido.subscribe(1, e, sig);
        vm.expectRevert();
        ido.openRefunds();
        vm.expectRevert();
        ido.setSaleEnd(1300);
        vm.expectRevert();
        ido.setSigner(BOB);
        ido.unfreeze("Continue refund workflow");
        ido.openRefunds();
        ido.emergencyFreeze("Pause refund");
        vm.expectRevert();
        vm.prank(ALICE);
        ido.claimRefund();
    }

    function _destination() internal returns (PhoodIDO) {
        PhoodIDO.Sale memory config = _sale();
        config.start = uint64(block.timestamp + 100);
        config.end = uint64(block.timestamp + 1000);
        return new PhoodIDO(
            address(this), vm.addr(SIGNER_KEY), address(this), IERC20Metadata(address(usdt)), keccak256("phood"), config
        );
    }

    function _prepare() internal returns (PhoodIDO next) {
        next = _destination();
        ido.emergencyFreeze("Bug fix");
        ido.proposeMigration(address(next));
        next.beginMigration(address(ido));
    }

    function testFreezeStopsClaimsAndManagement() public {
        _settle(10_000, 2000);
        ido.emergencyFreeze("Investigating");
        vm.warp(2300);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.claimAll();
        vm.expectRevert();
        vm.prank(ALICE);
        ido.claimTokens();
        vm.expectRevert();
        vm.prank(ALICE);
        ido.claimRebate();
        vm.expectRevert();
        ido.withdrawSurplus(usdt, 1);
        vm.expectRevert();
        ido.setTreasury(BOB);
        vm.expectRevert();
        ido.transferOwnership(BOB);
        ido.unfreeze("Resolved without migration");
        vm.prank(ALICE);
        ido.claimAll();
    }

    function testSuccessfulMigrationPreservesClaimsAndVesting() public {
        _settle(10_000, 2000);
        vm.warp(2300);
        vm.prank(ALICE);
        ido.claimAll();
        PhoodIDO next = _prepare();
        vm.expectRevert();
        ido.executeMigration();
        next.importNextBatch(20);
        require(next.migrationReady());
        require(keccak256(abi.encode(next.snapshot())) == keccak256(abi.encode(ido.snapshot())));
        vm.expectRevert();
        vm.prank(ALICE);
        next.claimAll();
        ido.executeMigration();
        require(ido.migrated() && !next.frozen() && !next.importing());
        require(usdt.balanceOf(address(ido)) == 0 && token.balanceOf(address(ido)) == 0);
        vm.expectRevert();
        ido.unfreeze("Cannot reopen");
        vm.expectRevert();
        vm.prank(ALICE);
        ido.claimTokens();
        vm.expectRevert();
        vm.prank(ALICE);
        next.claimRebate();
        vm.expectRevert();
        next.openRefunds();
        vm.expectRevert();
        next.configureVesting(PhoodIDO.Vesting(4000, 0, 1000, 100, 0, 0, 1000, 100));
        vm.warp(3200);
        vm.prank(ALICE);
        next.claimTokens();
        require(token.balanceOf(ALICE) == 10_000 ether);
        vm.expectRevert();
        ido.executeMigration();
    }

    function testRefundMigrationPreservesRefundedUsers() public {
        vm.warp(1100);
        _buy(ALICE, USER, 10_000);
        _buy(BOB, keccak256("bob"), 20_000);
        ido.openRefunds();
        vm.prank(ALICE);
        ido.claimRefund();
        PhoodIDO next = _prepare();
        next.importNextBatch(1);
        vm.expectRevert();
        ido.executeMigration();
        next.importNextBatch(1);
        ido.executeMigration();
        vm.expectRevert();
        vm.prank(ALICE);
        next.claimRefund();
        vm.prank(BOB);
        next.claimRefund();
        require(usdt.balanceOf(ALICE) == 10_000e6 && usdt.balanceOf(BOB) == 10_000e6);
        require(next.reservedPayment() == 0);
    }

    function testCancellationInvalidatesPartialDestination() public {
        vm.warp(1100);
        _buy(ALICE, USER, 10_000);
        PhoodIDO next = _prepare();
        ido.cancelMigration();
        ido.unfreeze("Resume");
        require(!next.migrationReady());
        vm.expectRevert();
        next.importNextBatch(1);
        vm.expectRevert();
        next.unfreeze("Cannot activate partial data");
        vm.expectRevert();
        next.completeMigration(0, 0);
        _buy(ALICE, USER, 1);
        PhoodIDO retry = _prepare();
        retry.importNextBatch(1);
        ido.executeMigration();
        require(retry.totalPaidCents() == 10_001);
    }

    function testPendingMigrationKeepsLimitsAndAllowsFreshCredential() public {
        vm.warp(1100);
        _buy(ALICE, USER, 10_000);
        PhoodIDO.Eligibility memory e = _credential(ALICE, USER);
        bytes memory oldSig = _signature(e);
        PhoodIDO next = _prepare();
        next.importNextBatch(1);
        ido.executeMigration();
        vm.prank(ALICE);
        usdt.approve(address(next), type(uint256).max);
        vm.expectRevert();
        vm.prank(ALICE);
        next.subscribe(1, e, oldSig);
        ido = next;
        _buy(ALICE, USER, 1);
        require(next.totalPaidCents() == 10_001);
    }

    function testMigrationOwnerAndRecipientChecks() public {
        PhoodIDO next = _destination();
        vm.expectRevert();
        vm.prank(ALICE);
        ido.emergencyFreeze("Unauthorized");
        ido.emergencyFreeze("Fix");
        vm.expectRevert();
        ido.proposeMigration(BOB);
        ido.proposeMigration(address(next));
        vm.expectRevert();
        vm.prank(ALICE);
        next.beginMigration(address(ido));
        next.beginMigration(address(ido));
        vm.expectRevert();
        vm.prank(ALICE);
        ido.executeMigration();
        vm.expectRevert();
        vm.prank(ALICE);
        next.completeMigration(0, 0);
        ido.executeMigration();
    }
}
