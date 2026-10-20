// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice One campaign per deployment. USD amounts use integer cents.
/// @dev Payment asset must be a non-rebasing, non-fee ERC20 with a stable USD value.
contract PhoodIDO is Ownable2Step, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error AllocationTooSmall();
    error BelowMinimum();
    error CapTooSmall();
    error ContractFrozen();
    error DestinationIncomplete();
    error DestinationUsed();
    error DuplicateAccount();
    error ExpiredCredential();
    error HardCap();
    error ImportComplete();
    error IncompatibleSource();
    error IncompatibleTarget();
    error InvalidActivation();
    error InvalidAddressId();
    error InvalidBatch();
    error InvalidCaps();
    error InvalidDuration();
    error InvalidEnd();
    error InvalidIdentity();
    error InvalidSignature();
    error InvalidSource();
    error InvalidTarget();
    error InvalidToken();
    error InvalidTreasury();
    error InvalidVesting();
    error InvalidWindow();
    error LengthMismatch();
    error MigrationActive();
    error MigrationInvalidated();
    error MissingParticipants();
    error NotCancelling();
    error NotImporting();
    error NotLocking();
    error NotMigrating();
    error NotParticipant();
    error NotProposing();
    error NotRegistering();
    error NotSettling();
    error NotSuccessful();
    error NothingToRebate();
    error NothingToRefund();
    error NothingVested();
    error OutsideSale();
    error OwnerRequired();
    error PaymentDecimals();
    error PaymentFundingMissing();
    error PaymentMismatch();
    error PaymentMissing();
    error PricePrecision();
    error ReasonRequired();
    error Refunding();
    error RefundsNotOpen();
    error ReservedFunds();
    error SaleEnded();
    error SaleLocked();
    error SaleUnavailable();
    error SettlementIncomplete();
    error SettlementIrreversible();
    error SnapshotChanged();
    error SourceChanged();
    error SourceIdentityMismatch();
    error SourceNotClosed();
    error SourceNotReady();
    error SupplyTooSmall();
    error TargetCodeChanged();
    error TargetIdentityMismatch();
    error TargetNotEmpty();
    error TokenAlreadyBound();
    error TokenFundingMissing();
    error TokenLocked();
    error TokenMissing();
    error TokenReserveMissing();
    error TokenTermsMismatch();
    error TokenVestingMissing();
    error UnsupportedPaymentToken();
    error UserAlreadyBound();
    error UserCap();
    error VestingLocked();
    error WalletAlreadyBound();
    error ZeroSigner();

    enum Phase {
        Pending,
        Successful,
        Refunding
    }

    struct Sale {
        uint64 start;
        uint64 end;
        uint256 softCapCents;
        uint256 hardCapCents;
        uint256 tokenUnitsPerDollar;
        uint256 saleAllocation;
        uint256 promisedSupply;
    }

    struct Vesting {
        uint64 start;
        uint64 cliff;
        uint64 duration;
        uint64 interval;
        uint16 initialBps;
        uint64 rebateCliff;
        uint64 rebateDuration;
        uint64 rebateInterval;
    }

    struct Eligibility {
        bytes32 userId;
        address wallet;
        uint256 maxCents;
        uint256 deadline;
        uint256 epoch;
    }

    struct Account {
        bytes32 userId;
        uint256 paidCents;
        uint256 rebateCents;
        uint256 claimedTokens;
        bool rebateRegistered;
        bool rebateClaimed;
        bool refunded;
    }

    bytes32 public constant ELIGIBILITY_TYPEHASH =
        keccak256("Eligibility(bytes32 userId,address wallet,uint256 maxCents,uint256 deadline,uint256 epoch)");
    uint256 public constant MIN_FIRST_CENTS = 10_000;
    uint256 public constant MAX_USER_CENTS = 100_000;
    uint256 public constant MAX_REBATE_CENTS = 20_000;
    IERC20 public immutable paymentToken;
    uint256 public immutable paymentUnitsPerCent;
    bytes32 public immutable campaignId;
    IERC20 public saleToken;
    address public signer;
    address public treasury;
    uint256 public signerEpoch;
    Sale public sale;
    Vesting public vesting;
    Phase public phase;
    bool public subscriptionsPaused;
    bool public rebatesLocked;
    uint256 public totalPaidCents;
    uint256 public totalRebateCents;
    uint256 public claimedRebateCents;
    uint256 public refundedCents;
    uint256 public totalAllocatedTokens;
    uint256 public totalClaimedTokens;
    uint256 public participantCount;
    uint256 public registeredCount;
    mapping(address => Account) public accounts;
    mapping(bytes32 => address) public userWallet;
    address[] public participants;
    bool public frozen;
    bool public migrated;
    bool public importing;
    address public migrationTarget;
    address public migrationSource;
    uint256 public migrationNonce;
    uint256 public sourceNonce;
    bytes32 public expectedSnapshot;
    bytes32 public targetCodeHash;

    struct Snapshot {
        Sale sale;
        Vesting vesting;
        Phase phase;
        address token;
        address signer;
        address treasury;
        uint256 signerEpoch;
        bool paused;
        bool rebatesLocked;
        uint256 paid;
        uint256 rebates;
        uint256 claimedRebates;
        uint256 refunded;
        uint256 allocated;
        uint256 claimedTokens;
        uint256 participants;
        uint256 registered;
    }

    event EmergencyFreeze(bool frozen, string reason);
    event MigrationProposed(address indexed target, uint256 nonce, bytes32 codeHash);
    event MigrationCancelled(address indexed target);
    event MigrationStarted(address indexed source, uint256 nonce, bytes32 snapshotHash);
    event MigrationBatchImported(uint256 imported, uint256 total);
    event MigrationCompleted(
        address indexed source, address indexed target, uint256 paymentAmount, uint256 tokenAmount
    );

    modifier operational() {
        if (!(!frozen && !migrated && !importing)) revert ContractFrozen();
        _;
    }

    event SaleConfigured(Sale config);
    event SaleEndChanged(uint64 oldEnd, uint64 newEnd);
    event VestingConfigured(Vesting config);
    event SignerChanged(address indexed signer, uint256 epoch);
    event TreasuryChanged(address indexed treasury);
    event SubscriptionsPaused(bool paused);
    event TokenBound(address indexed token);
    event Subscribed(bytes32 indexed userId, address indexed wallet, uint256 cents, uint256 cumulativeCents);
    event RebateRegistered(bytes32 indexed userId, address indexed wallet, uint256 score, uint256 rebateCents);
    event RebatesLocked(uint256 totalCents);
    event PhaseChanged(Phase phase);
    event RebateClaimed(bytes32 indexed userId, address indexed wallet, uint256 cents);
    event TokensClaimed(bytes32 indexed userId, address indexed wallet, uint256 amount);
    event Refunded(bytes32 indexed userId, address indexed wallet, uint256 cents);
    event SurplusWithdrawn(address indexed token, address indexed treasury, uint256 amount);

    constructor(
        address admin,
        address credentialSigner,
        address fundsTreasury,
        IERC20Metadata payment,
        bytes32 campaign,
        Sale memory config
    ) Ownable(admin) EIP712("P2L IDO", "1") {
        if (!(credentialSigner != address(0) && fundsTreasury != address(0) && campaign != bytes32(0))) revert InvalidAddressId();
        uint8 decimals = payment.decimals();
        if (!(decimals >= 2 && decimals <= 18)) revert PaymentDecimals();
        paymentToken = IERC20(address(payment));
        paymentUnitsPerCent = 10 ** (decimals - 2);
        campaignId = campaign;
        signer = credentialSigner;
        treasury = fundsTreasury;
        _configureSale(config);
    }

    function configureSale(Sale calldata config) external onlyOwner operational {
        if (!(phase == Phase.Pending && block.timestamp < sale.start)) revert SaleLocked();
        if (!(address(saleToken) == address(0))) revert TokenAlreadyBound();
        _configureSale(config);
    }

    function _configureSale(Sale memory config) internal {
        if (!(config.start > block.timestamp && config.end > config.start)) revert InvalidWindow();
        if (!(config.softCapCents > 0 && config.hardCapCents >= config.softCapCents)) revert InvalidCaps();
        if (!(config.hardCapCents >= MIN_FIRST_CENTS)) revert CapTooSmall();
        if (!(config.tokenUnitsPerDollar > 0 && config.tokenUnitsPerDollar % 100 == 0)) revert PricePrecision();
        if (!(config.saleAllocation >= Math.mulDiv(config.hardCapCents, config.tokenUnitsPerDollar, 100))) {
            revert AllocationTooSmall();
        }
        if (!(config.promisedSupply >= config.saleAllocation)) revert SupplyTooSmall();
        sale = config;
        emit SaleConfigured(config);
    }

    /// @notice End can be moved while still pending, but never reopens a closed sale.
    function setSaleEnd(uint64 newEnd) external onlyOwner operational {
        if (!(phase == Phase.Pending && block.timestamp < sale.end)) revert SaleEnded();
        if (!(newEnd >= block.timestamp && newEnd > sale.start)) revert InvalidEnd();
        emit SaleEndChanged(sale.end, newEnd);
        sale.end = newEnd;
    }

    function setSigner(address next) external onlyOwner operational {
        if (!(next != address(0))) revert ZeroSigner();
        signer = next;
        ++signerEpoch;
        emit SignerChanged(next, signerEpoch);
    }

    function setTreasury(address next) external onlyOwner operational {
        if (!(next != address(0) && next != address(this))) revert InvalidTreasury();
        treasury = next;
        emit TreasuryChanged(next);
    }

    function setSubscriptionsPaused(bool paused) external onlyOwner operational {
        subscriptionsPaused = paused;
        emit SubscriptionsPaused(paused);
    }

    // Removing the administrator would make manual settlement/refunds impossible.
    function renounceOwnership() public view override onlyOwner {
        revert OwnerRequired();
    }

    function eligibilityDigest(Eligibility calldata e) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ELIGIBILITY_TYPEHASH, e.userId, e.wallet, e.maxCents, e.deadline, e.epoch))
        );
    }

    function subscribe(uint256 cents, Eligibility calldata e, bytes calldata signature)
        external
        operational
        nonReentrant
    {
        if (!(phase == Phase.Pending && !subscriptionsPaused)) revert SaleUnavailable();
        if (!(block.timestamp >= sale.start && block.timestamp < sale.end)) revert OutsideSale();
        if (!(e.wallet == msg.sender && e.userId != bytes32(0))) revert InvalidIdentity();
        if (!(e.epoch == signerEpoch && block.timestamp <= e.deadline)) revert ExpiredCredential();
        if (!(ECDSA.recover(eligibilityDigest(e), signature) == signer)) revert InvalidSignature();
        Account storage a = accounts[msg.sender];
        if (!(cents > 0 && (a.paidCents > 0 || cents >= MIN_FIRST_CENTS))) revert BelowMinimum();
        uint256 cumulative = a.paidCents + cents;
        if (!(cumulative <= MAX_USER_CENTS && cumulative <= e.maxCents)) revert UserCap();
        if (!(totalPaidCents + cents <= sale.hardCapCents)) revert HardCap();
        if (a.paidCents == 0) {
            if (!(userWallet[e.userId] == address(0))) revert UserAlreadyBound();
            a.userId = e.userId;
            userWallet[e.userId] = msg.sender;
            participants.push(msg.sender);
            ++participantCount;
        } else {
            if (!(a.userId == e.userId)) revert WalletAlreadyBound();
        }
        a.paidCents = cumulative;
        totalPaidCents += cents;
        totalAllocatedTokens += Math.mulDiv(cents, sale.tokenUnitsPerDollar, 100);
        uint256 amount = cents * paymentUnitsPerCent;
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        if (!(paymentToken.balanceOf(address(this)) == beforeBalance + amount)) revert UnsupportedPaymentToken();
        emit Subscribed(e.userId, msg.sender, cents, cumulative);
    }

    function bindToken(IERC20Metadata token) external onlyOwner operational {
        if (!(phase == Phase.Pending && address(saleToken) == address(0))) revert TokenLocked();
        if (!(address(token) != address(paymentToken) && address(token) != address(0))) revert InvalidToken();
        if (!(token.decimals() == 18 && token.totalSupply() == sale.promisedSupply)) revert TokenTermsMismatch();
        saleToken = IERC20(address(token));
        emit TokenBound(address(token));
    }

    /// @notice Duration starts after the cliff; remainder releases in interval steps.
    function configureVesting(Vesting calldata config) external onlyOwner operational {
        if (!(phase != Phase.Refunding)) revert Refunding();
        if (!(phase != Phase.Successful || block.timestamp < vesting.start)) revert VestingLocked();
        if (!(config.start > block.timestamp && config.initialBps <= 10_000)) revert InvalidVesting();
        if (!(config.duration > 0 && config.interval > 0 && config.interval <= config.duration)) {
            revert InvalidDuration();
        }
        if (config.rebateDuration == 0 || config.rebateInterval == 0 || config.rebateInterval > config.rebateDuration) {
            revert InvalidDuration();
        }
        vesting = config;
        emit VestingConfigured(config);
    }

    /// @notice Every buyer, including zero-score buyers, must be registered before locking.
    function registerRebates(address[] calldata wallets, uint256[] calldata scores) external onlyOwner operational {
        if (!(phase == Phase.Pending && block.timestamp >= sale.end && !rebatesLocked)) revert NotRegistering();
        if (!(wallets.length == scores.length)) revert LengthMismatch();
        for (uint256 i; i < wallets.length; ++i) {
            Account storage a = accounts[wallets[i]];
            if (!(a.paidCents > 0)) revert NotParticipant();
            uint256 rebate = Math.min(Math.min(scores[i], MAX_REBATE_CENTS), a.paidCents / 5);
            totalRebateCents = totalRebateCents - a.rebateCents + rebate;
            a.rebateCents = rebate;
            if (!a.rebateRegistered) {
                a.rebateRegistered = true;
                ++registeredCount;
            }
            emit RebateRegistered(a.userId, wallets[i], scores[i], rebate);
        }
    }

    function lockRebates() external onlyOwner operational {
        if (!(phase == Phase.Pending && block.timestamp >= sale.end && !rebatesLocked)) revert NotLocking();
        if (!(registeredCount == participantCount)) revert MissingParticipants();
        rebatesLocked = true;
        emit RebatesLocked(totalRebateCents);
    }

    function finalizeSuccess() external onlyOwner operational {
        if (!(phase == Phase.Pending && block.timestamp >= sale.end)) revert NotSettling();
        if (!(totalPaidCents >= sale.softCapCents && rebatesLocked)) revert SettlementIncomplete();
        if (!(vesting.start > block.timestamp && address(saleToken) != address(0))) revert TokenVestingMissing();
        if (!(saleToken.balanceOf(address(this)) >= totalAllocatedTokens)) revert TokenFundingMissing();
        if (!(paymentToken.balanceOf(address(this)) >= totalPaidCents * paymentUnitsPerCent)) {
            revert PaymentFundingMissing();
        }
        phase = Phase.Successful;
        emit PhaseChanged(phase);
    }

    function openRefunds() external onlyOwner operational {
        if (!(phase == Phase.Pending)) revert SettlementIrreversible();
        phase = Phase.Refunding;
        emit PhaseChanged(phase);
    }

    function claimRefund() external operational nonReentrant {
        if (!(phase == Phase.Refunding)) revert RefundsNotOpen();
        Account storage a = accounts[msg.sender];
        if (!(a.paidCents > 0 && !a.refunded)) revert NothingToRefund();
        a.refunded = true;
        refundedCents += a.paidCents;
        paymentToken.safeTransfer(msg.sender, a.paidCents * paymentUnitsPerCent);
        emit Refunded(a.userId, msg.sender, a.paidCents);
    }

    /// @notice Cash rebate claims never change either token allocation.
    function _tokenAllocations(address wallet) internal view returns (uint256 base, uint256 rebate) {
        Account storage a = accounts[wallet];
        uint256 total = Math.mulDiv(a.paidCents, sale.tokenUnitsPerDollar, 100);
        rebate = Math.mulDiv(a.rebateCents, sale.tokenUnitsPerDollar, 100);
        base = total - rebate;
    }

    function vestedTokenParts(address wallet)
        public
        view
        returns (uint256 base, uint256 rebate, uint256 baseAllocation, uint256 rebateAllocation)
    {
        (baseAllocation, rebateAllocation) = _tokenAllocations(wallet);
        if (phase != Phase.Successful || block.timestamp < vesting.start) {
            return (0, 0, baseAllocation, rebateAllocation);
        }
        base = _vested(baseAllocation, vesting.cliff, vesting.duration, vesting.interval, vesting.initialBps);
        rebate = _vested(rebateAllocation, vesting.rebateCliff, vesting.rebateDuration, vesting.rebateInterval, 0);
    }

    function _vested(uint256 allocation, uint64 cliff, uint64 duration, uint64 interval, uint16 initialBps)
        internal
        view
        returns (uint256)
    {
        // Schedules validate initialBps <= 10_000. Timestamps are uint64,
        // and elapsed is subtracted only after the ordering check below.
        unchecked {
            uint256 initial = Math.mulDiv(allocation, initialBps, 10_000);
            uint256 linearStart = uint256(vesting.start) + cliff;
            if (block.timestamp <= linearStart) return initial;
            uint256 elapsed = block.timestamp - linearStart;
            if (elapsed >= duration) return allocation;
            elapsed = elapsed / interval * interval;
            return initial + Math.mulDiv(allocation - initial, elapsed, duration);
        }
    }

    function vestedTokens(address wallet) public view returns (uint256) {
        (uint256 base, uint256 rebate,,) = vestedTokenParts(wallet);
        return base + rebate;
    }

    function claimTokens() external operational nonReentrant {
        _claimTokens(msg.sender, true);
    }

    function claimRebate() external operational nonReentrant {
        _claimRebate(msg.sender, true);
    }

    function claimAll() external operational nonReentrant {
        if (!(phase == Phase.Successful)) revert NotSuccessful();
        _claimRebate(msg.sender, false);
        _claimTokens(msg.sender, false);
    }

    function _claimTokens(address wallet, bool requireAmount) internal {
        if (!(phase == Phase.Successful)) revert NotSuccessful();
        Account storage a = accounts[wallet];
        uint256 amount = vestedTokens(wallet) - a.claimedTokens;
        if (requireAmount) if (!(amount > 0)) revert NothingVested();
        if (amount == 0) return;
        a.claimedTokens += amount;
        totalClaimedTokens += amount;
        saleToken.safeTransfer(wallet, amount);
        emit TokensClaimed(a.userId, wallet, amount);
    }

    function _claimRebate(address wallet, bool requireAmount) internal {
        if (!(phase == Phase.Successful)) revert NotSuccessful();
        Account storage a = accounts[wallet];
        uint256 cents = a.rebateClaimed ? 0 : a.rebateCents;
        if (requireAmount) if (!(cents > 0)) revert NothingToRebate();
        if (cents == 0) return;
        a.rebateClaimed = true;
        claimedRebateCents += cents;
        paymentToken.safeTransfer(wallet, cents * paymentUnitsPerCent);
        emit RebateClaimed(a.userId, wallet, cents);
    }

    function migrationVersion() external pure returns (bytes32) {
        return keccak256("P2L_IDO_MIGRATION_V2");
    }

    function accountSnapshot(address wallet) external view returns (Account memory) {
        return accounts[wallet];
    }

    function snapshot() public view returns (Snapshot memory s) {
        s = Snapshot(
            sale,
            vesting,
            phase,
            address(saleToken),
            signer,
            treasury,
            signerEpoch,
            subscriptionsPaused,
            rebatesLocked,
            totalPaidCents,
            totalRebateCents,
            claimedRebateCents,
            refundedCents,
            totalAllocatedTokens,
            totalClaimedTokens,
            participantCount,
            registeredCount
        );
    }

    function transferOwnership(address next) public override onlyOwner operational {
        super.transferOwnership(next);
    }

    function acceptOwnership() public override operational {
        super.acceptOwnership();
    }

    function emergencyFreeze(string calldata reason) external onlyOwner operational {
        if (!(bytes(reason).length > 0 && bytes(reason).length <= 512)) revert ReasonRequired();
        frozen = true;
        emit EmergencyFreeze(true, reason);
    }

    function unfreeze(string calldata reason) external onlyOwner {
        if (!(frozen && !migrated && !importing && migrationTarget == address(0))) revert MigrationActive();
        if (!(bytes(reason).length > 0 && bytes(reason).length <= 512)) revert ReasonRequired();
        frozen = false;
        emit EmergencyFreeze(false, reason);
    }

    function proposeMigration(address target) external onlyOwner {
        if (!(frozen && !migrated && !importing && migrationTarget == address(0))) revert NotProposing();
        if (!(target != address(this) && target.code.length > 0)) revert InvalidTarget();
        PhoodIDO next = PhoodIDO(target);
        if (!(next.migrationVersion() == keccak256("P2L_IDO_MIGRATION_V2"))) revert IncompatibleTarget();
        if (!(next.owner() == owner() && next.campaignId() == campaignId)) revert TargetIdentityMismatch();
        if (!(address(next.paymentToken()) == address(paymentToken))) revert PaymentMismatch();
        if (!(next.participantCount() == 0 && !next.importing() && !next.migrated())) revert TargetNotEmpty();
        migrationTarget = target;
        targetCodeHash = target.codehash;
        ++migrationNonce;
        emit MigrationProposed(target, migrationNonce, targetCodeHash);
    }

    /// @notice Cancelling invalidates a partial destination; use a fresh destination for retry.
    function cancelMigration() external onlyOwner {
        if (!(frozen && !migrated && !importing && migrationTarget != address(0))) revert NotCancelling();
        emit MigrationCancelled(migrationTarget);
        migrationTarget = address(0);
        targetCodeHash = bytes32(0);
        ++migrationNonce;
    }

    function beginMigration(address source) external onlyOwner operational {
        if (!(participantCount == 0 && address(saleToken) == address(0) && phase == Phase.Pending)) {
            revert DestinationUsed();
        }
        if (!(source != address(this) && source.code.length > 0)) revert InvalidSource();
        PhoodIDO previous = PhoodIDO(source);
        if (!(previous.migrationVersion() == keccak256("P2L_IDO_MIGRATION_V2"))) revert IncompatibleSource();
        if (!(previous.frozen() && !previous.migrated() && previous.migrationTarget() == address(this))) {
            revert SourceNotReady();
        }
        if (!(previous.owner() == owner() && previous.campaignId() == campaignId)) revert SourceIdentityMismatch();
        if (!(address(previous.paymentToken()) == address(paymentToken))) revert PaymentMismatch();
        Snapshot memory s = previous.snapshot();
        sale = s.sale;
        vesting = s.vesting;
        phase = s.phase;
        saleToken = IERC20(s.token);
        signer = s.signer;
        treasury = s.treasury;
        signerEpoch = s.signerEpoch;
        subscriptionsPaused = s.paused;
        rebatesLocked = s.rebatesLocked;
        frozen = true;
        importing = true;
        migrationSource = source;
        sourceNonce = previous.migrationNonce();
        expectedSnapshot = keccak256(abi.encode(s));
        emit MigrationStarted(source, sourceNonce, expectedSnapshot);
    }

    function _checkSource() internal view returns (PhoodIDO previous) {
        if (!(importing)) revert NotImporting();
        previous = PhoodIDO(migrationSource);
        if (!(previous.frozen() && previous.migrationTarget() == address(this))) revert SourceChanged();
        if (!(previous.migrationNonce() == sourceNonce)) revert MigrationInvalidated();
        if (!(keccak256(abi.encode(previous.snapshot())) == expectedSnapshot)) revert SnapshotChanged();
    }

    /// @notice Copies accounts directly from the frozen chain state, never from editable JSON amounts.
    function importNextBatch(uint256 count) external onlyOwner {
        PhoodIDO previous = _checkSource();
        if (!(!previous.migrated() && count > 0 && count <= 100)) revert InvalidBatch();
        uint256 end = Math.min(participantCount + count, previous.participantCount());
        if (!(end > participantCount)) revert ImportComplete();
        while (participantCount < end) {
            address wallet = previous.participants(participantCount);
            Account memory a = previous.accountSnapshot(wallet);
            if (!(a.paidCents > 0 && accounts[wallet].paidCents == 0 && userWallet[a.userId] == address(0))) {
                revert DuplicateAccount();
            }
            accounts[wallet] = a;
            userWallet[a.userId] = wallet;
            participants.push(wallet);
            ++participantCount;
            totalPaidCents += a.paidCents;
            totalRebateCents += a.rebateCents;
            totalAllocatedTokens += Math.mulDiv(a.paidCents, sale.tokenUnitsPerDollar, 100);
            totalClaimedTokens += a.claimedTokens;
            if (a.rebateRegistered) ++registeredCount;
            if (a.rebateClaimed) claimedRebateCents += a.rebateCents;
            if (a.refunded) refundedCents += a.paidCents;
        }
        emit MigrationBatchImported(participantCount, previous.participantCount());
    }

    function migrationReady() public view returns (bool) {
        if (!importing) return false;
        PhoodIDO previous = PhoodIDO(migrationSource);
        return previous.frozen() && previous.migrationTarget() == address(this)
            && previous.migrationNonce() == sourceNonce
            && keccak256(abi.encode(previous.snapshot())) == expectedSnapshot
            && keccak256(abi.encode(snapshot())) == expectedSnapshot;
    }

    /// @notice Transfer and destination activation happen atomically in the same transaction.
    function executeMigration() external onlyOwner nonReentrant {
        if (!(frozen && !migrated && !importing && migrationTarget != address(0))) revert NotMigrating();
        if (!(migrationTarget.codehash == targetCodeHash)) revert TargetCodeChanged();
        PhoodIDO next = PhoodIDO(migrationTarget);
        if (!(next.owner() == owner() && next.migrationSource() == address(this) && next.migrationReady())) {
            revert DestinationIncomplete();
        }
        uint256 paymentAmount = paymentToken.balanceOf(address(this));
        uint256 tokenAmount = address(saleToken) == address(0) ? 0 : saleToken.balanceOf(address(this));
        migrated = true;
        paymentToken.safeTransfer(migrationTarget, paymentAmount);
        if (tokenAmount > 0) saleToken.safeTransfer(migrationTarget, tokenAmount);
        next.completeMigration(paymentAmount, tokenAmount);
        emit MigrationCompleted(address(this), migrationTarget, paymentAmount, tokenAmount);
    }

    function completeMigration(uint256 paymentAmount, uint256 tokenAmount) external nonReentrant {
        if (!(msg.sender == migrationSource && importing && migrationReady())) revert InvalidActivation();
        PhoodIDO previous = _checkSource();
        if (!(previous.migrated())) revert SourceNotClosed();
        uint256 balance = paymentToken.balanceOf(address(this));
        if (!(balance >= paymentAmount && balance >= reservedPayment())) revert PaymentMissing();
        if (address(saleToken) != address(0)) {
            balance = saleToken.balanceOf(address(this));
            if (!(balance >= tokenAmount)) revert TokenMissing();
            if (phase == Phase.Successful) {
                if (!(balance >= totalAllocatedTokens - totalClaimedTokens)) revert TokenReserveMissing();
            }
        }
        importing = false;
        frozen = false;
        emit MigrationCompleted(migrationSource, address(this), paymentAmount, tokenAmount);
    }

    function reservedPayment() public view returns (uint256) {
        uint256 cents =
            phase == Phase.Successful ? totalRebateCents - claimedRebateCents : totalPaidCents - refundedCents;
        return cents * paymentUnitsPerCent;
    }

    function withdrawSurplus(IERC20 token, uint256 amount) external onlyOwner operational nonReentrant {
        uint256 reserve;
        if (address(token) == address(paymentToken)) reserve = reservedPayment();
        if (address(token) == address(saleToken) && phase != Phase.Refunding) {
            reserve = totalAllocatedTokens - totalClaimedTokens;
        }
        uint256 balance = token.balanceOf(address(this));
        if (!(balance >= reserve && amount <= balance - reserve)) revert ReservedFunds();
        token.safeTransfer(treasury, amount);
        emit SurplusWithdrawn(address(token), treasury, amount);
    }
}
