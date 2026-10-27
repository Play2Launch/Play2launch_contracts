// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {P2LAirdrop} from "../src/P2LAirdrop.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
interface AirdropVm {function addr(uint256) external returns(address);function sign(uint256,bytes32) external returns(uint8,bytes32,bytes32);function prank(address) external;function expectRevert() external;function warp(uint256) external;}
contract AirdropToken is ERC20 {constructor() ERC20("Drop","DROP"){}function mint(address to,uint256 n)external{_mint(to,n);}}
contract P2LAirdropTest {
 AirdropVm constant vm=AirdropVm(address(uint160(uint256(keccak256("hevm cheat code")))));
 P2LAirdrop drop;AirdropToken token;address alice;uint256 signerKey=123;bytes32 id=keccak256("user");
 function setUp()public{alice=vm.addr(77);token=new AirdropToken();drop=new P2LAirdrop(address(this),keccak256("campaign"),address(token),vm.addr(signerKey));}
 function configure(uint64 end)internal{drop.configure(keccak256(bytes.concat(keccak256(abi.encode(id,uint256(100))))),100,end);token.mint(address(drop),100);drop.open();}
 function signature(uint256 amount,uint256 expires,address wallet)internal returns(bytes memory){(uint8 v,bytes32 r,bytes32 s)=vm.sign(signerKey,drop.claimDigest(id,wallet,amount,expires));return abi.encodePacked(r,s,v);}
 function testClaimOnceAndRejectWrongWalletAndAmount()public{
  configure(0);bytes memory sig=signature(100,block.timestamp+100,alice);bytes32[] memory proof=new bytes32[](0);
  vm.expectRevert();drop.claim(id,100,block.timestamp+100,proof,sig);
  vm.prank(alice);vm.expectRevert();drop.claim(id,101,block.timestamp+100,proof,sig);
  vm.prank(alice);drop.claim(id,100,block.timestamp+100,proof,sig);require(token.balanceOf(alice)==100&&drop.claimed(id));
  vm.prank(alice);vm.expectRevert();drop.claim(id,100,block.timestamp+100,proof,sig);
 }
 function testNoDeadlineRecoveryClosesForever()public{configure(0);bytes memory sig=signature(100,block.timestamp+100,alice);drop.recover(address(this));require(drop.closed()&&token.balanceOf(address(this))==100);vm.prank(alice);vm.expectRevert();drop.claim(id,100,block.timestamp+100,new bytes32[](0),sig);vm.expectRevert();drop.open();vm.expectRevert();drop.configure(bytes32(uint256(1)),1,0);}
 function testDeadlineRecoveryAndExtension()public{configure(uint64(block.timestamp+100));vm.expectRevert();drop.recover(address(this));vm.expectRevert();drop.extendDeadline(uint64(block.timestamp+50));drop.extendDeadline(uint64(block.timestamp+200));vm.warp(block.timestamp+200);drop.recover(address(this));require(drop.closed());}
 function testPauseFundingAndOwnership()public{
  drop.configure(keccak256(bytes.concat(keccak256(abi.encode(id,uint256(100))))),100,0);vm.expectRevert();drop.open();token.mint(address(drop),100);drop.open();drop.setPaused(true);bytes memory sig=signature(100,block.timestamp+100,alice);vm.prank(alice);vm.expectRevert();drop.claim(id,100,block.timestamp+100,new bytes32[](0),sig);
  vm.prank(alice);vm.expectRevert();drop.recover(alice);drop.setPaused(false);vm.prank(alice);drop.claim(id,100,block.timestamp+100,new bytes32[](0),sig);
 }
 function testProofAndSignatureCannotCrossContracts()public{configure(0);P2LAirdrop other=new P2LAirdrop(address(this),keccak256("campaign"),address(token),vm.addr(signerKey));other.configure(drop.root(),100,0);token.mint(address(other),100);other.open();bytes memory sig=signature(100,block.timestamp+100,alice);vm.prank(alice);vm.expectRevert();other.claim(id,100,block.timestamp+100,new bytes32[](0),sig);}
 function testFuzzTwoUsers(uint96 a,uint96 b)public{
  uint256 amountA=uint256(a)+1;uint256 amountB=uint256(b)+1;bytes32 idB=keccak256("other");bytes32 leafA=keccak256(bytes.concat(keccak256(abi.encode(id,amountA))));bytes32 leafB=keccak256(bytes.concat(keccak256(abi.encode(idB,amountB))));bytes32 root=leafA<leafB?keccak256(abi.encode(leafA,leafB)):keccak256(abi.encode(leafB,leafA));drop.configure(root,amountA+amountB,0);token.mint(address(drop),amountA+amountB);drop.open();bytes32[] memory proof=new bytes32[](1);proof[0]=leafB;bytes memory sig=signature(amountA,block.timestamp+100,alice);vm.prank(alice);drop.claim(id,amountA,block.timestamp+100,proof,sig);require(drop.claimedTotal()==amountA);drop.recover(address(this));require(token.balanceOf(address(this))==amountB);
 }
}
