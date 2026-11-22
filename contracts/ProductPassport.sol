// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Product ownership and warranty authority. Private repair text stays off-chain.
/// @dev Roles are immutable grants by the deployment administrator. No funds are accepted.
contract ProductPassport {
    enum Role { None, Manufacturer, Retailer, Customer, ServiceCenter }
    enum TransferStatus { None, Pending, Accepted, Rejected, Cancelled }
    enum ClaimStatus { None, Submitted, Approved, Rejected, Completed }
    struct Product {
        address manufacturer;
        address owner;
        uint32 warrantyDays;
        uint16 maxClaims;
        uint16 claimsUsed;
        uint64 createdAt;
        uint64 warrantyStarted;
        uint64 warrantyExpires;
        bytes16 pendingTransfer;
        bytes16 openClaim;
        string serial;
        string model;
        string manufacturerName;
    }
    struct Transfer { bytes16 productId; address from; address to; TransferStatus status; }
    struct Claim { bytes16 productId; address customer; address center; ClaimStatus status; bytes32 descriptionHash; bytes32 resultHash; }
    address public immutable administrator;
    bytes32 public immutable deploymentId;
    mapping(address => Role) public roles;
    mapping(bytes16 => Product) private products;
    mapping(bytes16 => Transfer) private transfers;
    mapping(bytes16 => Claim) private claims;
    mapping(bytes32 => bytes16) public serialProducts;
    mapping(address => mapping(bytes32 => bool)) public operations;

    event RoleGranted(address indexed wallet, Role role);
    event ProductRegistered(bytes32 indexed operationId, bytes16 indexed productId, address indexed manufacturer, string serial, string model, string manufacturerName, uint32 warrantyDays, uint16 maxClaims);
    event TransferRequested(bytes32 indexed operationId, bytes16 indexed transferId, bytes16 indexed productId, address from, address to);
    event TransferResolved(bytes32 indexed operationId, bytes16 indexed transferId, TransferStatus status, uint64 warrantyStarted, uint64 warrantyExpires);
    event ClaimSubmitted(bytes32 indexed operationId, bytes16 indexed claimId, bytes16 indexed productId, address customer, address center, bytes32 descriptionHash);
    event ClaimResolved(bytes32 indexed operationId, bytes16 indexed claimId, ClaimStatus status, bytes32 resultHash);
    event OperationRecorded(bytes32 indexed operationId, address indexed actor, bytes16 entityId, uint8 kind);

    constructor(bytes32 instanceId) { require(instanceId != bytes32(0), "Invalid deployment ID"); administrator = msg.sender; deploymentId = instanceId; }
    modifier once(bytes32 operationId) {
        require(operationId != bytes32(0) && !operations[msg.sender][operationId], "Operation already used");
        operations[msg.sender][operationId] = true;
        _;
    }
    function grantRole(address wallet, Role role) external {
        require(msg.sender == administrator, "Administrator required");
        require(wallet != address(0) && role != Role.None, "Invalid role grant");
        require(roles[wallet] == Role.None, "Role is immutable");
        roles[wallet] = role;
        emit RoleGranted(wallet, role);
    }
    function getProduct(bytes16 id) external view returns (Product memory) { return products[id]; }
    function getTransfer(bytes16 id) external view returns (Transfer memory) { return transfers[id]; }
    function getClaim(bytes16 id) external view returns (Claim memory) { return claims[id]; }
    function registerProduct(bytes32 op, bytes16 id, string calldata serial, string calldata model, string calldata manufacturerName, uint32 days_, uint16 limit) external once(op) {
        require(roles[msg.sender] == Role.Manufacturer, "Manufacturer required");
        _validId(id);
        require(products[id].manufacturer == address(0), "Product ID exists");
        require(days_ > 0 && days_ <= 36500 && limit > 0 && limit <= 1000, "Invalid warranty terms");
        _validText(bytes(model)); _validText(bytes(manufacturerName));
        bytes32 key = _serialKey(serial);
        require(serialProducts[key] == bytes16(0), "Serial number exists");
        serialProducts[key] = id;
        Product storage p = products[id];
        p.manufacturer = msg.sender; p.owner = msg.sender; p.warrantyDays = days_; p.maxClaims = limit;
        p.createdAt = uint64(block.timestamp); p.serial = serial; p.model = model; p.manufacturerName = manufacturerName;
        emit ProductRegistered(op, id, msg.sender, serial, model, manufacturerName, days_, limit);
        emit OperationRecorded(op, msg.sender, id, 1);
    }
    function requestTransfer(bytes32 op, bytes16 id, bytes16 productId, address to) external once(op) {
        _validId(id); Product storage p = products[productId];
        require(p.owner == msg.sender && p.owner != address(0), "Current owner required");
        require(to != msg.sender && to != address(0), "Invalid recipient");
        Role fromRole = roles[msg.sender]; Role toRole = roles[to];
        require((fromRole == Role.Manufacturer && toRole == Role.Retailer) || (fromRole == Role.Retailer && toRole == Role.Customer) || (fromRole == Role.Customer && toRole == Role.Customer), "Invalid transfer role direction");
        require(p.pendingTransfer == bytes16(0) && p.openClaim == bytes16(0), "Resolve pending workflow first");
        require(transfers[id].status == TransferStatus.None, "Transfer ID exists");
        transfers[id] = Transfer(productId, msg.sender, to, TransferStatus.Pending); p.pendingTransfer = id;
        emit TransferRequested(op, id, productId, msg.sender, to);
        emit OperationRecorded(op, msg.sender, id, 2);
    }
    /// @param action 1=accept, 2=reject, 3=cancel.
    function resolveTransfer(bytes32 op, bytes16 id, uint8 action) external once(op) {
        require(action >= 1 && action <= 3, "Invalid transfer action");
        Transfer storage t = transfers[id];
        require(t.status == TransferStatus.Pending, "Transfer is not pending");
        require(msg.sender == (action == 3 ? t.from : t.to), "Transfer participant required");
        Product storage p = products[t.productId];
        require(p.owner == t.from && p.pendingTransfer == id && p.openClaim == bytes16(0), "Transfer state conflict");
        if (action == 1) {
            p.owner = t.to;
            if (p.warrantyStarted == 0 && roles[t.from] == Role.Retailer && roles[t.to] == Role.Customer) {
                p.warrantyStarted = uint64(block.timestamp);
                p.warrantyExpires = uint64(block.timestamp + uint256(p.warrantyDays) * 1 days);
            }
        }
        t.status = TransferStatus(action + 1); p.pendingTransfer = bytes16(0);
        emit TransferResolved(op, id, t.status, p.warrantyStarted, p.warrantyExpires);
        emit OperationRecorded(op, msg.sender, id, 3);
    }
    function submitClaim(bytes32 op, bytes16 id, bytes16 productId, address center, bytes32 descriptionHash) external once(op) {
        _validId(id); Product storage p = products[productId];
        require(roles[msg.sender] == Role.Customer && p.owner == msg.sender, "Current customer owner required");
        require(roles[center] == Role.ServiceCenter, "Registered service center required");
        require(p.pendingTransfer == bytes16(0) && p.openClaim == bytes16(0), "Resolve pending workflow first");
        require(p.warrantyStarted != 0 && block.timestamp < p.warrantyExpires && p.claimsUsed < p.maxClaims, "Warranty unavailable");
        require(claims[id].status == ClaimStatus.None && descriptionHash != bytes32(0), "Invalid claim");
        claims[id] = Claim(productId, msg.sender, center, ClaimStatus.Submitted, descriptionHash, bytes32(0)); p.openClaim = id;
        emit ClaimSubmitted(op, id, productId, msg.sender, center, descriptionHash);
        emit OperationRecorded(op, msg.sender, id, 4);
    }
    /// @param action 1=approve, 2=reject, 3=complete. Hashes commit to salted private text.
    function resolveClaim(bytes32 op, bytes16 id, uint8 action, bytes32 resultHash) external once(op) {
        Claim storage c = claims[id];
        require(roles[msg.sender] == Role.ServiceCenter && c.center == msg.sender, "Assigned service center required");
        require(action >= 1 && action <= 3, "Invalid claim action");
        require(action == 3 ? c.status == ClaimStatus.Approved : c.status == ClaimStatus.Submitted, "Invalid claim transition");
        require(action == 1 ? resultHash == bytes32(0) : resultHash != bytes32(0), "Repair or rejection commitment required");
        Product storage p = products[c.productId];
        require(p.openClaim == id && p.owner == c.customer, "Claim state conflict");
        if (action == 3) { require(p.claimsUsed < p.maxClaims, "Allowance exhausted"); p.claimsUsed++; }
        c.status = ClaimStatus(action + 1); c.resultHash = resultHash;
        if (action != 1) p.openClaim = bytes16(0);
        emit ClaimResolved(op, id, c.status, resultHash);
        emit OperationRecorded(op, msg.sender, id, 5);
    }
    function _serialKey(string calldata serial) private pure returns (bytes32) {
        bytes memory b = bytes(serial); require(b.length > 0 && b.length <= 120, "Invalid serial length");
        for (uint256 i; i < b.length; i++) {
            uint8 c = uint8(b[i]); require(c >= 33 && c <= 126, "Serial must be printable ASCII without spaces");
            if (c >= 65 && c <= 90) b[i] = bytes1(c + 32);
        }
        return keccak256(b);
    }
    function _validId(bytes16 id) private pure {
        // Use UUIDv4 bytes to keep a single canonical identifier in the API and chain.
        uint128 v = uint128(id);
        require(((v >> 64) & 0xf000) == 0x4000 && ((v >> 56) & 0xc0) == 0x80, "UUIDv4 required");
    }
    // Canonical UTF-8 keeps direct callers' event strings decodable and within
    // SQLite's 120-character model constraint; malformed metadata cannot stop replay.
    function _validText(bytes memory value) private pure {
        require(value.length > 0 && value.length <= 480, "Invalid product metadata");
        uint256 count; bool visible;
        for (uint256 i; i < value.length;) {
            uint8 c = uint8(value[i]); uint256 n;
            if (c < 0x80) { n = 1; if (c != 32) visible = true; }
            else if (c >= 0xc2 && c <= 0xdf) { n = 2; visible = true; }
            else if (c >= 0xe0 && c <= 0xef) { n = 3; visible = true; }
            else if (c >= 0xf0 && c <= 0xf4) { n = 4; visible = true; }
            else revert("Invalid UTF-8");
            require(i + n <= value.length && c != 0, "Invalid UTF-8");
            for (uint256 j = 1; j < n; j++) require(uint8(value[i+j]) >= 0x80 && uint8(value[i+j]) <= 0xbf, "Invalid UTF-8");
            if (n == 3) require((c != 0xe0 || uint8(value[i+1]) >= 0xa0) && (c != 0xed || uint8(value[i+1]) < 0xa0), "Invalid UTF-8");
            if (n == 4) require((c != 0xf0 || uint8(value[i+1]) >= 0x90) && (c != 0xf4 || uint8(value[i+1]) <= 0x8f), "Invalid UTF-8");
            i += n; count++;
        }
        require(count <= 120 && visible, "Invalid product metadata");
    }
}
