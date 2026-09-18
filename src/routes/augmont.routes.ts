import express from "express";
import {
  buyGold,
  createOrder,
  createUser,
  deleteUserAddress,
  getBuyInvoice,
  getBuyList,
  getBuyStatus,
  getCities,
  getHistoricalData,
  getOrderInfo,
  getOrderList,
  getPassbook,
  getProduct,
  getProducts,
  getRates,
  getRedeemInvoice,
  getSellInvoice,
  getSellList,
  getSellStatus,
  getSipRates,
  getStates,
  getTransferInfo,
  getTransferList,
  getUser,
  getUserAddresses,
  getUserBanks,
  getUserKyc,
  getWithdrawStatus,
  login,
  saveUserAddress,
  updateUser,
} from "../controllers/augmont.controller";
import { verifyFirebaseToken } from "../middleware/auth";

const router = express.Router();

router.get("/login", verifyFirebaseToken, login);
router.get("/rates", verifyFirebaseToken, getRates);
router.get("/historical-data", verifyFirebaseToken, getHistoricalData);
router.get("/master/states", verifyFirebaseToken, getStates);
router.get("/master/cities", verifyFirebaseToken, getCities);
router.get("/products", verifyFirebaseToken, getProducts);
router.get("/products/:sku", verifyFirebaseToken, getProduct);
router.get("/sip/rates", verifyFirebaseToken, getSipRates);

router.post("/users", verifyFirebaseToken, createUser);
router.get("/users/:uniqueId", verifyFirebaseToken, getUser);
router.put("/users/:uniqueId", verifyFirebaseToken, updateUser);
router.get("/users/:uniqueId/kyc", verifyFirebaseToken, getUserKyc);
router.post("/users/:uniqueId/kyc", verifyFirebaseToken, (_req, res) =>
  res.status(410).json({ message: "Complete KYC through the verified ExGold KYC flow" })
);
router.get("/users/:uniqueId/passbook", verifyFirebaseToken, getPassbook);

router.post("/users/:uniqueId/banks", verifyFirebaseToken, (_req, res) =>
  res.status(410).json({
    message: "Add and verify the bank account through ExGold before selling gold",
  })
);
router.get("/users/:uniqueId/banks", verifyFirebaseToken, getUserBanks);
router.post("/users/:uniqueId/banks/:userBankId", verifyFirebaseToken, (_req, res) =>
  res.status(410).json({
    message: "Update and re-verify the bank account through ExGold",
  })
);
router.delete("/users/:uniqueId/banks/:userBankId", verifyFirebaseToken, (_req, res) =>
  res.status(410).json({
    message: "Manage the verified payout bank account through ExGold",
  })
);

router.post("/users/:uniqueId/address", verifyFirebaseToken, saveUserAddress);
router.get("/users/:uniqueId/address", verifyFirebaseToken, getUserAddresses);
router.delete(
  "/users/:uniqueId/address/:userAddressId",
  verifyFirebaseToken,
  deleteUserAddress
);

// Provider purchases are internal to the verified payment checkout workflow.
router.post("/buy", verifyFirebaseToken, (_req, res) =>
  res.status(410).json({ message: "Use the paid checkout flow for digital gold" })
);
router.get("/users/:uniqueId/buy", verifyFirebaseToken, getBuyList);
router.get("/buy/:merchantTransactionId/:uniqueId", verifyFirebaseToken, getBuyStatus);

router.post("/sell", verifyFirebaseToken, (_req, res) =>
  res.status(410).json({ message: "Use the tracked investment sell flow" })
);
router.get("/users/:uniqueId/sell", verifyFirebaseToken, getSellList);
router.get("/sell/:merchantTransactionId/:uniqueId", verifyFirebaseToken, getSellStatus);

// Physical product orders may only be created after a verified gateway payment.
router.post("/order", verifyFirebaseToken, (_req, res) =>
  res.status(410).json({ message: "Use the paid checkout flow for physical products" })
);
router.get("/users/:uniqueId/order", verifyFirebaseToken, getOrderList);
router.get("/order/:merchantTransactionId/:uniqueId", verifyFirebaseToken, getOrderInfo);

router.post("/transfer", verifyFirebaseToken, (_req, res) =>
  res.status(410).json({ message: "Gold transfer is not available in ExGold" })
);
router.get("/users/:uniqueId/transfer", verifyFirebaseToken, getTransferList);
router.get(
  "/transfer/:merchantTransactionId/:uniqueId",
  verifyFirebaseToken,
  getTransferInfo
);

router.get("/withdraw/:sellTxnId/:uniqueId", verifyFirebaseToken, getWithdrawStatus);
router.put("/withdraw/:sellTxnId/:uniqueId", verifyFirebaseToken, (_req, res) =>
  res.status(410).json({
    message: "Use the tracked ExGold wallet withdrawal flow",
  })
);

router.get("/invoice/buy/:transactionId", verifyFirebaseToken, getBuyInvoice);
router.get("/invoice/sell/:transactionId", verifyFirebaseToken, getSellInvoice);
router.get("/invoice/order/:transactionId", verifyFirebaseToken, getRedeemInvoice);

router.post("/user-address", verifyFirebaseToken, saveUserAddress);
router.post("/user-kyc", verifyFirebaseToken, (_req, res) =>
  res.status(410).json({ message: "Complete KYC through the verified ExGold KYC flow" })
);
router.get("/user-kyc", verifyFirebaseToken, getUserKyc);
router.get("/orders", verifyFirebaseToken, getOrderList);
router.get("/buy/:merchantTransactionId/status", verifyFirebaseToken, getBuyStatus);
router.get("/sell/:merchantTransactionId/status", verifyFirebaseToken, getSellStatus);
router.get("/withdraw/:merchantTransactionId/status", verifyFirebaseToken, getWithdrawStatus);

export default router;
