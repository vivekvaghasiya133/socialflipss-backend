const Admin = require("../models/Admin");

module.exports = async function seedAdmin() {
  const count = await Admin.countDocuments();
  if (count === 0) {
    await Admin.create({
      email: process.env.ADMIN_EMAIL || "admin@socialflipss.com",
      password: process.env.ADMIN_PASSWORD || "Admin@123",
      name: "SocialFlipss Admin",
    });
    console.log("✓ Default admin created — change password after first login!");
  }
};
