// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// One immutable distribution per campaign. Tokens with transfer fees/rebasing are unsupported.
contract P2LAirdrop is Ownable2Step, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public immutable campaignHash;
    IERC20 public immutable token;
    address public immutable signer;
    bytes32 public root;
    uint256 public allocation;
    uint256 public claimedTotal;
    uint64 public deadline;
    bool public opened;
    bool public paused;
    bool public closed;
    mapping(bytes32 => bool) public claimed;
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(bytes32 root,bytes32 claimId,address wallet,uint256 amount,uint256 expires)");
    event Configured(bytes32 root,uint256 allocation,uint64 deadline);
    event Opened();
    event PauseChanged(bool paused);
    event DeadlineExtended(uint64 deadline);
    event Claimed(bytes32 indexed claimId,address indexed wallet,uint256 amount);
    event Recovered(address indexed recipient,uint256 amount);
    constructor(address owner_,bytes32 campaign_,address token_,address signer_) Ownable(owner_) EIP712("P2LAirdrop","1") {
        require(campaign_!=bytes32(0)&&token_.code.length>0&&signer_!=address(0),"invalid configuration");
        campaignHash=campaign_;token=IERC20(token_);signer=signer_;
    }
    function version() external pure returns(uint256){return 1;}
    function configure(bytes32 root_,uint256 total_,uint64 deadline_) external onlyOwner {
        require(root==bytes32(0)&&!closed&&root_!=bytes32(0)&&total_>0,"already configured");
        require(deadline_==0||deadline_>block.timestamp,"past deadline");
        root=root_;allocation=total_;deadline=deadline_;emit Configured(root_,total_,deadline_);
    }
    function open() external onlyOwner {
        require(!opened&&!closed&&root!=bytes32(0),"unavailable");
        require(deadline==0||block.timestamp<deadline,"expired");
        require(token.balanceOf(address(this))>=allocation,"insufficient funding");
        opened=true;emit Opened();
    }
    function setPaused(bool value) external onlyOwner {require(opened&&!closed,"unavailable");paused=value;emit PauseChanged(value);}
    function extendDeadline(uint64 value) external onlyOwner {
        require(!closed&&root!=bytes32(0)&&deadline!=0&&(value==0||value>deadline),"cannot shorten");
        deadline=value;emit DeadlineExtended(value);
    }
    function claimDigest(bytes32 id,address wallet,uint256 amount,uint256 expires) public view returns(bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH,root,id,wallet,amount,expires)));
    }
    function claim(bytes32 id,uint256 amount,uint256 expires,bytes32[] calldata proof,bytes calldata signature) external nonReentrant {
        require(opened&&!paused&&!closed&&(deadline==0||block.timestamp<deadline),"claim closed");
        require(!claimed[id]&&amount>0&&block.timestamp<=expires,"invalid claim");
        require(MerkleProof.verify(proof,root,keccak256(bytes.concat(keccak256(abi.encode(id,amount))))),"invalid proof");
        require(ECDSA.recover(claimDigest(id,msg.sender,amount,expires),signature)==signer,"invalid authorization");
        require(claimedTotal+amount<=allocation,"allocation exceeded");
        claimed[id]=true;claimedTotal+=amount;
        token.safeTransfer(msg.sender,amount);emit Claimed(id,msg.sender,amount);
    }
    /// No deadline means the owner may recover at any time. Recovery permanently closes claims.
    function recover(address recipient) external onlyOwner nonReentrant {
        require(recipient!=address(0)&&recipient!=address(this),"invalid recipient");
        require(deadline==0||block.timestamp>=deadline,"deadline not reached");
        closed=true;paused=true;
        uint256 amount=token.balanceOf(address(this));token.safeTransfer(recipient,amount);emit Recovered(recipient,amount);
    }
}
