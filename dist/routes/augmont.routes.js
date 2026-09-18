"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const augmont_controller_1 = require("../controllers/augmont.controller");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
router.get("/login", auth_1.verifyFirebaseToken, augmont_controller_1.login);
router.get("/rates", auth_1.verifyFirebaseToken, augmont_controller_1.getRates);
router.get("/historical-data", auth_1.verifyFirebaseToken, augmont_controller_1.getHistoricalData);
router.get("/master/states", auth_1.verifyFirebaseToken, augmont_controller_1.getStates);
router.get("/master/cities", auth_1.verifyFirebaseToken, augmont_controller_1.getCities);
router.get("/products", auth_1.verifyFirebaseToken, augmont_controller_1.getProducts);
router.get("/products/:sku", auth_1.verifyFirebaseToken, augmont_controller_1.getProduct);
router.get("/sip/rates", auth_1.verifyFirebaseToken, augmont_controller_1.getSipRates);
router.post("/users", auth_1.verifyFirebaseToken, augmont_controller_1.createUser);
router.get("/users/:uniqueId", auth_1.verifyFirebaseToken, augmont_controller_1.getUser);
router.put("/users/:uniqueId", auth_1.verifyFirebaseToken, augmont_controller_1.updateUser);
router.get("/users/:uniqueId/kyc", auth_1.verifyFirebaseToken, augmont_controller_1.getUserKyc);
router.post("/users/:uniqueId/kyc", auth_1.verifyFirebaseToken, (_req, res) => res.status(410).json({ message: "Complete KYC through the verified ExGold KYC flow" }));
router.get("/users/:uniqueId/passbook", auth_1.verifyFirebaseToken, augmont_controller_1.getPassbook);
router.post("/users/:uniqueId/banks", auth_1.verifyFirebaseToken, (_req, res) => res.status(410).json({
    message: "Add and verify the bank account through ExGold before selling gold",
}));
router.get("/users/:uniqueId/banks", auth_1.verifyFirebaseToken, augmont_controller_1.getUserBanks);
router.post("/users/:uniqueId/banks/:userBankId", auth_1.verifyFirebaseToken, (_req, res) => res.status(410).json({
    message: "Update and re-verify the bank account through ExGold",
}));
router.delete("/users/:uniqueId/banks/:userBankId", auth_1.verifyFirebaseToken, (_req, res) => res.status(410).json({
    message: "Manage the verified payout bank account through ExGold",
}));
router.post("/users/:uniqueId/address", auth_1.verifyFirebaseToken, augmont_controller_1.saveUserAddress);
router.get("/users/:uniqueId/address", auth_1.verifyFirebaseToken, augmont_controller_1.getUserAddresses);
router.delete("/users/:uniqueId/address/:userAddressId", auth_1.verifyFirebaseToken, augmont_controller_1.deleteUserAddress);
// Provider purchases are internal to the verified payment checkout workflow.
router.post("/buy", auth_1.verifyFirebaseToken, (_req, res) => res.status(410).json({ message: "Use the paid checkout flow for digital gold" }));
router.get("/users/:uniqueId/buy", auth_1.verifyFirebaseToken, augmont_controller_1.getBuyList);
router.get("/buy/:merchantTransactionId/:uniqueId", auth_1.verifyFirebaseToken, augmont_controller_1.getBuyStatus);
router.post("/sell", auth_1.verifyFirebaseToken, (_req, res) => res.status(410).json({ message: "Use the tracked investment sell flow" }));
router.get("/users/:uniqueId/sell", auth_1.verifyFirebaseToken, augmont_controller_1.getSellList);
router.get("/sell/:merchantTransactionId/:uniqueId", auth_1.verifyFirebaseToken, augmont_controller_1.getSellStatus);
// Physical product orders may only be created after a verified gateway payment.
router.post("/order", auth_1.verifyFirebaseToken, (_req, res) => res.status(410).json({ message: "Use the paid checkout flow for physical products" }));
router.get("/users/:uniqueId/order", auth_1.verifyFirebaseToken, augmont_controller_1.getOrderList);
router.get("/order/:merchantTransactionId/:uniqueId", auth_1.verifyFirebaseToken, augmont_controller_1.getOrderInfo);
router.post("/transfer", auth_1.verifyFirebaseToken, (_req, res) => res.status(410).json({ message: "Gold transfer is not available in ExGold" }));
router.get("/users/:uniqueId/transfer", auth_1.verifyFirebaseToken, augmont_controller_1.getTransferList);
router.get("/transfer/:merchantTransactionId/:uniqueId", auth_1.verifyFirebaseToken, augmont_controller_1.getTransferInfo);
router.get("/withdraw/:sellTxnId/:uniqueId", auth_1.verifyFirebaseToken, augmont_controller_1.getWithdrawStatus);
router.put("/withdraw/:sellTxnId/:uniqueId", auth_1.verifyFirebaseToken, (_req, res) => res.status(410).json({
    message: "Use the tracked ExGold wallet withdrawal flow",
}));
router.get("/invoice/buy/:transactionId", auth_1.verifyFirebaseToken, augmont_controller_1.getBuyInvoice);
router.get("/invoice/sell/:transactionId", auth_1.verifyFirebaseToken, augmont_controller_1.getSellInvoice);
router.get("/invoice/order/:transactionId", auth_1.verifyFirebaseToken, augmont_controller_1.getRedeemInvoice);
router.post("/user-address", auth_1.verifyFirebaseToken, augmont_controller_1.saveUserAddress);
router.post("/user-kyc", auth_1.verifyFirebaseToken, (_req, res) => res.status(410).json({ message: "Complete KYC through the verified ExGold KYC flow" }));
router.get("/user-kyc", auth_1.verifyFirebaseToken, augmont_controller_1.getUserKyc);
router.get("/orders", auth_1.verifyFirebaseToken, augmont_controller_1.getOrderList);
router.get("/buy/:merchantTransactionId/status", auth_1.verifyFirebaseToken, augmont_controller_1.getBuyStatus);
router.get("/sell/:merchantTransactionId/status", auth_1.verifyFirebaseToken, augmont_controller_1.getSellStatus);
router.get("/withdraw/:merchantTransactionId/status", auth_1.verifyFirebaseToken, augmont_controller_1.getWithdrawStatus);
exports.default = router;
