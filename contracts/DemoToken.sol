// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-network currency. Supply is minted once; there is no mint authority.
contract DemoToken is ERC20 {
    constructor(string memory name_, string memory symbol_, address treasury)
        ERC20(name_, symbol_)
    {
        _mint(treasury, 1_000_000 * 10 ** decimals());
    }
}
