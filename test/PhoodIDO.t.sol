// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PhoodIDO} from "../src/PhoodIDO.sol";
import {PHOOD} from "../src/PHOOD.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function expectRevert() external;
}

contract MockUSDT is ERC20 {
    constructor() ERC20("Test USDT", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PhoodIDOTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant SIGNER_KEY = 12345;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    bytes32 constant USER = keccak256("user-1");
    uint256 constant SUPPLY = 1_000_000 ether;
    PhoodIDO ido;
    MockUSDT usdt;
    PHOOD token;

    function setUp() public {
        vm.warp(1000);
        usdt = new MockUSDT();
        token = new PHOOD(address(this), SUPPLY);
        ido = new PhoodIDO(
            address(this),
            vm.addr(SIGNER_KEY),
            address(this),
            IERC20Metadata(address(usdt)),
            keccak256("phood"),
            _sale()
        );
        usdt.mint(ALICE, 10_000e6);
        usdt.mint(BOB, 10_000e6);
        vm.prank(ALICE);
        usdt.approve(address(ido), type(uint256).max);
        vm.prank(BOB);
        usdt.approve(address(ido), type(uint256).max);
    }

    function _sale() internal pure returns (PhoodIDO.Sale memory) {
        // Small caps for unit tests only; deployment example uses $10k/$50k.
        return PhoodIDO.Sale(1100, 2000, 10_000, 100_000, 100 ether, 100_000 ether, SUPPLY);
    }

    function _credential(address wallet, bytes32 user) internal view returns (PhoodIDO.Eligibility memory) {
        return PhoodIDO.Eligibility(user, wallet, 100_000, 2000, ido.signerEpoch());
    }

    function _signature(PhoodIDO.Eligibility memory e) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, ido.eligibilityDigest(e));
        return abi.encodePacked(r, s, v);
    }

    function _buy(address wallet, bytes32 user, uint256 cents) internal {
        PhoodIDO.Eligibility memory e = _credential(wallet, user);
        bytes memory sig = _signature(e);
        vm.prank(wallet);
        ido.subscribe(cents, e, sig);
    }

    function _register(uint256 score) internal {
        address[] memory wallets = new address[](1);
        wallets[0] = ALICE;
        uint256[] memory scores = new uint256[](1);
        scores[0] = score;
        ido.registerRebates(wallets, scores);
    }

    function _settle(uint256 cents, uint256 score) internal {
        vm.warp(1100);
        _buy(ALICE, USER, cents);
        vm.warp(2000);
        ido.bindToken(IERC20Metadata(address(token)));
        require(token.transfer(address(ido), ido.totalAllocatedTokens()));
        ido.configureVesting(PhoodIDO.Vesting(2100, 100, 1000, 100, 1000, 100, 1000, 100));
        _register(score);
        ido.lockRebates();
        ido.finalizeSuccess();
    }

    function testTokenFixedSupply() public view {
        require(token.totalSupply() == SUPPLY && token.balanceOf(address(this)) == SUPPLY);
        require(token.decimals() == 18);
        require(address(ido).code.length <= 24_576, "EIP-170 deployment size");
    }

    function testFirstMinimumAndCentTopup() public {
        vm.warp(1100);
        PhoodIDO.Eligibility memory e = _credential(ALICE, USER);
        bytes memory sig = _signature(e);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.subscribe(9999, e, sig);
        _buy(ALICE, USER, 10_000);
        _buy(ALICE, USER, 1);
        require(ido.totalPaidCents() == 10_001 && ido.participantCount() == 1);
        require(ido.totalAllocatedTokens() == 10_001 ether);
    }

    function testWalletAndUserCannotBeRebound() public {
        vm.warp(1100);
        _buy(ALICE, USER, 10_000);
        PhoodIDO.Eligibility memory e = _credential(BOB, USER);
        bytes memory sig = _signature(e);
        vm.expectRevert();
        vm.prank(BOB);
        ido.subscribe(10_000, e, sig);
        e = _credential(ALICE, keccak256("different"));
        sig = _signature(e);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.subscribe(1, e, sig);
    }

    function testSignatureReplayOnAnotherContractFails() public {
        PhoodIDO other = new PhoodIDO(
            address(this),
            vm.addr(SIGNER_KEY),
            address(this),
            IERC20Metadata(address(usdt)),
            keccak256("other"),
            _sale()
        );
        PhoodIDO.Eligibility memory e = _credential(ALICE, USER);
        bytes memory sig = _signature(e);
        vm.warp(1100);
        vm.expectRevert();
        vm.prank(ALICE);
        other.subscribe(10_000, e, sig);
    }

    function testSignerRotationRevokesOldCredentials() public {
        PhoodIDO.Eligibility memory e = _credential(ALICE, USER);
        bytes memory sig = _signature(e);
        ido.setSigner(vm.addr(SIGNER_KEY));
        vm.warp(1100);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.subscribe(10_000, e, sig);
        _buy(ALICE, USER, 10_000);
    }

    function testUserAndHardCaps() public {
        vm.warp(1100);
        _buy(ALICE, USER, 100_000);
        PhoodIDO.Eligibility memory e = _credential(ALICE, USER);
        bytes memory sig = _signature(e);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.subscribe(1, e, sig);
        e = _credential(BOB, keccak256("bob"));
        sig = _signature(e);
        vm.expectRevert();
        vm.prank(BOB);
        ido.subscribe(10_000, e, sig);
    }

    function testManualRefundOnlyAndNoDoubleClaim() public {
        vm.warp(1100);
        _buy(ALICE, USER, 10_000);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.claimRefund();
        vm.expectRevert();
        vm.prank(ALICE);
        ido.openRefunds();
        vm.expectRevert();
        ido.withdrawSurplus(usdt, 1);
        ido.openRefunds();
        vm.prank(ALICE);
        ido.claimRefund();
        require(usdt.balanceOf(ALICE) == 10_000e6 && ido.reservedPayment() == 0);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.claimRefund();
        vm.expectRevert();
        ido.finalizeSuccess();
    }

    function testSettlementRequiresAllRebatesAndTokenFunding() public {
        vm.warp(1100);
        _buy(ALICE, USER, 10_000);
        vm.warp(2000);
        vm.expectRevert();
        ido.lockRebates();
        _register(0);
        ido.lockRebates();
        vm.expectRevert();
        ido.finalizeSuccess();
        ido.bindToken(IERC20Metadata(address(token)));
        ido.configureVesting(PhoodIDO.Vesting(2100, 0, 1000, 100, 0, 0, 1000, 100));
        vm.expectRevert();
        ido.finalizeSuccess();
        require(token.transfer(address(ido), ido.totalAllocatedTokens()));
        ido.finalizeSuccess();
    }

    function testRebateAndPrincipalAreSeparate() public {
        _settle(100_000, 99_999);
        require(ido.totalRebateCents() == 20_000);
        vm.expectRevert();
        ido.openRefunds();
        vm.expectRevert();
        ido.withdrawSurplus(usdt, 800e6 + 1);
        ido.withdrawSurplus(usdt, 800e6);
        vm.prank(ALICE);
        ido.claimRebate();
        require(usdt.balanceOf(ALICE) == 9200e6);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.claimRebate();
        require(ido.reservedPayment() == 0);
    }

    function testVestingCliffStepsAndFullRelease() public {
        _settle(10_000, 2000);
        require(ido.vestedTokens(ALICE) == 0);
        vm.warp(2100);
        require(ido.vestedTokens(ALICE) == 800 ether);
        vm.prank(ALICE);
        ido.claimAll();
        require(token.balanceOf(ALICE) == 800 ether);
        vm.warp(2299);
        require(ido.vestedTokens(ALICE) == 800 ether);
        vm.warp(2300);
        require(ido.vestedTokens(ALICE) == 1720 ether);
        vm.warp(3200);
        vm.prank(ALICE);
        ido.claimTokens();
        require(token.balanceOf(ALICE) == 10_000 ether);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.claimTokens();
    }

    function testVestingMutableBeforeStartOnlyAndReservesProtected() public {
        _settle(10_000, 2000);
        ido.configureVesting(PhoodIDO.Vesting(2200, 0, 1000, 100, 0, 0, 1000, 100));
        vm.expectRevert();
        ido.withdrawSurplus(token, 1);
        vm.warp(2200);
        vm.expectRevert();
        ido.configureVesting(PhoodIDO.Vesting(2300, 0, 1000, 100, 0, 0, 1000, 100));
    }

    function testSaleEndChangeAndTermsLock() public {
        vm.warp(1100);
        vm.expectRevert();
        ido.configureSale(_sale());
        ido.setSaleEnd(1200);
        vm.warp(1200);
        vm.expectRevert();
        ido.setSaleEnd(2000);
    }

    function testTokenBindingIsPermanent() public {
        ido.bindToken(IERC20Metadata(address(token)));
        vm.expectRevert();
        ido.bindToken(IERC20Metadata(address(token)));
    }

    function testOwnershipTwoStep() public {
        ido.transferOwnership(BOB);
        require(ido.owner() == address(this));
        vm.prank(BOB);
        ido.acceptOwnership();
        require(ido.owner() == BOB);
        vm.expectRevert();
        ido.openRefunds();
        vm.prank(BOB);
        ido.openRefunds();
    }

    function testRebateCorrectionDoesNotDuplicateAndLocks() public {
        vm.warp(1100);
        _buy(ALICE, USER, 10_000);
        vm.warp(2000);
        _register(2000);
        _register(100);
        require(ido.registeredCount() == 1 && ido.totalRebateCents() == 100);
        ido.lockRebates();
        address[] memory wallets = new address[](1);
        wallets[0] = ALICE;
        uint256[] memory scores = new uint256[](1);
        vm.expectRevert();
        ido.registerRebates(wallets, scores);
    }

    function testBelowSoftCapNeedsManualRefund() public {
        PhoodIDO.Sale memory config = _sale();
        config.softCapCents = 20_000;
        ido.configureSale(config);
        vm.warp(1100);
        _buy(ALICE, USER, 10_000);
        vm.warp(2000);
        _register(0);
        ido.lockRebates();
        vm.expectRevert();
        ido.finalizeSuccess();
        vm.expectRevert();
        vm.prank(ALICE);
        ido.claimRefund();
        ido.openRefunds();
        vm.prank(ALICE);
        ido.claimRefund();
    }

    function testExpiredWrongCallerAndTamperedCredential() public {
        PhoodIDO.Eligibility memory e = _credential(ALICE, USER);
        e.deadline = 1150;
        bytes memory sig = _signature(e);
        vm.warp(1100);
        vm.expectRevert();
        vm.prank(BOB);
        ido.subscribe(10_000, e, sig);
        e.maxCents = 99_999;
        vm.expectRevert();
        vm.prank(ALICE);
        ido.subscribe(10_000, e, sig);
        e.maxCents = 100_000;
        vm.warp(1151);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.subscribe(10_000, e, sig);
    }

    function testPauseStopsPurchasesWithoutGrantingRefunds() public {
        vm.warp(1100);
        ido.setSubscriptionsPaused(true);
        PhoodIDO.Eligibility memory e = _credential(ALICE, USER);
        bytes memory sig = _signature(e);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.subscribe(10_000, e, sig);
        ido.setSubscriptionsPaused(false);
        _buy(ALICE, USER, 10_000);
    }

    function testLateSettlementCanRescheduleUnstartedVesting() public {
        ido.configureVesting(PhoodIDO.Vesting(1200, 0, 1000, 100, 0, 0, 1000, 100));
        vm.warp(2000);
        ido.configureVesting(PhoodIDO.Vesting(2100, 0, 1000, 100, 0, 0, 1000, 100));
    }

    function testMultiBuyerReservesRemainAfterFirstClaim() public {
        vm.warp(1100);
        _buy(ALICE, USER, 10_000);
        _buy(BOB, keccak256("bob"), 20_000);
        vm.warp(2000);
        ido.bindToken(IERC20Metadata(address(token)));
        require(token.transfer(address(ido), ido.totalAllocatedTokens() + 100 ether));
        ido.configureVesting(PhoodIDO.Vesting(2100, 0, 1000, 100, 10_000, 0, 1000, 100));
        address[] memory wallets = new address[](2);
        wallets[0] = ALICE;
        wallets[1] = BOB;
        uint256[] memory scores = new uint256[](2);
        scores[0] = 2000;
        scores[1] = 4000;
        ido.registerRebates(wallets, scores);
        ido.lockRebates();
        ido.finalizeSuccess();
        ido.withdrawSurplus(usdt, 240e6);
        ido.withdrawSurplus(token, 100 ether);
        vm.warp(2100);
        vm.prank(ALICE);
        ido.claimAll();
        require(ido.reservedPayment() == 40e6);
        require(token.balanceOf(address(ido)) == 22_000 ether);
        vm.expectRevert();
        ido.withdrawSurplus(token, 1);
        vm.expectRevert();
        ido.withdrawSurplus(usdt, 1);
        vm.prank(BOB);
        ido.claimAll();
        require(token.balanceOf(BOB) == 16_000 ether && ido.reservedPayment() == 0);
    }

    function testFuzzVestingMonotonicAndFullyFunded(uint32 first, uint32 second) public {
        _settle(10_000, 2000);
        uint256 t1 = 2000 + uint256(first) % 2000;
        uint256 t2 = t1 + uint256(second) % 2000;
        vm.warp(t1);
        uint256 v1 = ido.vestedTokens(ALICE);
        vm.prank(ALICE);
        ido.claimAll();
        vm.warp(t2);
        uint256 v2 = ido.vestedTokens(ALICE);
        vm.prank(ALICE);
        ido.claimAll();
        require(v2 >= v1 && v2 <= 10_000 ether);
        require(token.balanceOf(ALICE) == v2);
        require(token.balanceOf(address(ido)) == 10_000 ether - v2);
    }

    function testFuzzRebate(uint32 seedCents, uint32 score) public {
        uint256 cents = 10_000 + uint256(seedCents) % 90_001;
        _settle(cents, score);
        uint256 expected = score;
        if (expected > 20_000) expected = 20_000;
        if (expected > cents / 5) expected = cents / 5;
        require(ido.totalRebateCents() == expected);
        require(ido.reservedPayment() <= cents * 10_000);
    }

    function testSplitRecommendedScheduleAndCashClaimIndependence() public {
        _settle(10_001, 2000);
        ido.configureVesting(PhoodIDO.Vesting(2100, 0, 90 days, 1, 3000, 30 days, 90 days, 1));
        (,, uint256 base, uint256 rebate) = ido.vestedTokenParts(ALICE);
        require(base == 8001 ether && rebate == 2000 ether && base + rebate == ido.totalAllocatedTokens());
        vm.warp(2100);
        (uint256 b, uint256 r,,) = ido.vestedTokenParts(ALICE);
        require(b == base * 30 / 100 && r == 0);
        vm.prank(ALICE);
        ido.claimRebate();
        (,, uint256 afterBase, uint256 afterRebate) = ido.vestedTokenParts(ALICE);
        require(afterBase == base && afterRebate == rebate);
        vm.warp(2100 + 30 days);
        (, r,,) = ido.vestedTokenParts(ALICE);
        require(r == 0);
        vm.warp(2100 + 30 days + 1);
        (, r,,) = ido.vestedTokenParts(ALICE);
        require(r == rebate / 90 days);
        vm.warp(2100 + 90 days);
        (b, r,,) = ido.vestedTokenParts(ALICE);
        require(b == base && r == rebate * 60 / 90);
        vm.prank(ALICE);
        ido.claimTokens();
        vm.warp(2100 + 120 days);
        vm.prank(ALICE);
        ido.claimTokens();
        require(token.balanceOf(ALICE) == base + rebate);
        vm.expectRevert();
        vm.prank(ALICE);
        ido.claimTokens();
    }

    function testZeroRebateUsesOnlyBaseSchedule() public {
        _settle(10_000, 0);
        ido.configureVesting(PhoodIDO.Vesting(2100, 0, 90 days, 1, 3000, 30 days, 90 days, 1));
        (,, uint256 base, uint256 rebate) = ido.vestedTokenParts(ALICE);
        require(base == 10_000 ether && rebate == 0);
        vm.warp(2100 + 90 days);
        require(ido.vestedTokens(ALICE) == base);
    }

    function testSplitScheduleValidationAndSharedLock() public {
        vm.expectRevert();
        ido.configureVesting(PhoodIDO.Vesting(2100, 0, 90 days, 1, 3000, 30 days, 0, 1));
        vm.expectRevert();
        ido.configureVesting(PhoodIDO.Vesting(2100, 0, 90 days, 1, 3000, 30 days, 90 days, 91 days));
        _settle(10_000, 2000);
        vm.warp(2100);
        vm.expectRevert();
        ido.configureVesting(PhoodIDO.Vesting(2200, 0, 90 days, 1, 3000, 0, 1, 1));
    }
}
