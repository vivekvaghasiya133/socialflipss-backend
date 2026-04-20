const User = require("../models/User");

module.exports = async function seedAdmin() {
  const count = await User.countDocuments({ role: "admin" });
  if (count === 0) {
    await User.create({
      name:     "SocialFlipss Admin",
      email:    process.env.ADMIN_EMAIL    || "admin@socialflipss.com",
      password: process.env.ADMIN_PASSWORD || "Admin@123",
      role:     "admin",
      position: "Admin",
      status:   "active",
    });
    console.log("✓ Default admin created");
  }
};
