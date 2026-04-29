const jwt        = require("jsonwebtoken");
const ClientAuth = require("../models/ClientAuth");
const Client     = require("../models/Client");

// Protect client portal routes
const protectClient = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized — please login" });
  }
  try {
    const token   = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET + "_client");
    const auth    = await ClientAuth.findById(decoded.authId);
    if (!auth || !auth.isActive) return res.status(401).json({ message: "Session expired. Please login again." });

    const client = await Client.findById(auth.clientId);
    if (!client) return res.status(401).json({ message: "Client not found" });

    req.clientAuth   = auth;
    req.clientRecord = client;
    next();
  } catch {
    return res.status(401).json({ message: "Unauthorized — invalid token" });
  }
};

module.exports = { protectClient };
