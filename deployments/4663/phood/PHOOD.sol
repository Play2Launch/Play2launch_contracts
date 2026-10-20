// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed supply; supply is expressed in smallest units (18 decimals).
contract PHOOD is ERC20 {
    constructor(address treasury, uint256 supply) ERC20("PAPERHOOD", "PHOOD") {
        require(treasury != address(0) && supply > 0, "Invalid issuance");
        _mint(treasury, supply);
    }
}
