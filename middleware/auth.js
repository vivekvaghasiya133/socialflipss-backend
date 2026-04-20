const jwt  = require("jsonwebtoken");
const User = require("../models/User");

// Verify JWT token
const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized — no token" });
  }
  try {
    const token   = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id).select("-password");
    if (!user || user.status === "inactive")
      return res.status(401).json({ message: "User not found or inactive" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Unauthorized — invalid token" });
  }
};

// Role check middleware factory
// Usage: authorize("admin") or authorize("admin", "manager")
const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({
      message: `Access denied. Required role: ${roles.join(" or ")}`,
    });
  }
  next();
};

module.exports = { protect, authorize };
