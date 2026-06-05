const express = require("express");
const Invoice = require("../models/Invoice");
const HisabPassword = require("../models/HisabPassword");
const HisabTransaction = require("../models/HisabTransaction");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);
router.use(authorize("admin")); // Only admin can access Hisab routes

// Normalize person name to title case
function normalizeName(name) {
  if (!name) return "";
  const cleaned = name.trim().toLowerCase();
  if (cleaned === "vivek") return "Vivek";
  if (cleaned === "kuldeep") return "Kuldeep";
  // Title case custom names
  return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

// GET /api/hisab/stats — get hisab overview by person
router.get("/stats", async (req, res) => {
  try {
    const invoices = await Invoice.find({ "payments.0": { $exists: true } });
    const transactions = await HisabTransaction.find().sort({ date: -1 });

    const peopleMap = {
      "Vivek": { person: "Vivek", collected: { cash: 0, upi: 0, bank: 0, cheque: 0, other: 0 }, totalCollected: 0, totalWithdrawn: 0, totalSettled: 0, balance: 0 },
      "Kuldeep": { person: "Kuldeep", collected: { cash: 0, upi: 0, bank: 0, cheque: 0, other: 0 }, totalCollected: 0, totalWithdrawn: 0, totalSettled: 0, balance: 0 }
    };

    // 1. Process all collections from invoices
    invoices.forEach(inv => {
      inv.payments.forEach(p => {
        let personKey = "Vivek";
        if (p.collectedBy === "kuldeep") personKey = "Kuldeep";
        else if (p.collectedBy === "other") personKey = normalizeName(p.collectedByCustom) || "Other";
        else personKey = normalizeName(p.collectedBy) || "Vivek";

        if (!peopleMap[personKey]) {
          peopleMap[personKey] = {
            person: personKey,
            collected: { cash: 0, upi: 0, bank: 0, cheque: 0, other: 0 },
            totalCollected: 0,
            totalWithdrawn: 0,
            totalSettled: 0,
            balance: 0
          };
        }

        const method = p.method || "upi";
        const amt = p.amount || 0;

        if (peopleMap[personKey].collected[method] !== undefined) {
          peopleMap[personKey].collected[method] += amt;
        } else {
          peopleMap[personKey].collected.other += amt;
        }
        peopleMap[personKey].totalCollected += amt;
      });
    });

    // 2. Process all withdrawals (draw) and settlements (settle)
    transactions.forEach(t => {
      const personKey = normalizeName(t.person);
      if (!peopleMap[personKey]) {
        peopleMap[personKey] = {
          person: personKey,
          collected: { cash: 0, upi: 0, bank: 0, cheque: 0, other: 0 },
          totalCollected: 0,
          totalWithdrawn: 0,
          totalSettled: 0,
          balance: 0
        };
      }

      if (t.type === "draw") {
        peopleMap[personKey].totalWithdrawn += t.amount;
      } else if (t.type === "settle") {
        peopleMap[personKey].totalSettled += t.amount;
      }
    });

    // 3. Compute net balances
    Object.keys(peopleMap).forEach(key => {
      const p = peopleMap[key];
      p.balance = p.totalCollected - p.totalWithdrawn - p.totalSettled;
    });

    res.json({
      people: Object.values(peopleMap),
      transactions
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/hisab/password/status — Check if password is set
router.get("/password/status", async (req, res) => {
  try {
    const pw = await HisabPassword.findOne();
    res.json({ isSet: !!pw });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/hisab/password/verify — Verify password
router.post("/password/verify", async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: "Password required" });

    const pw = await HisabPassword.findOne();
    if (!pw) {
      return res.status(400).json({ success: false, message: "No password set yet. Please set password first." });
    }

    const isMatch = await pw.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Incorrect password" });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/hisab/password/set — Set / update password
router.post("/password/set", async (req, res) => {
  try {
    const { password, currentPassword } = req.body;
    if (!password) return res.status(400).json({ message: "New password required" });

    let pw = await HisabPassword.findOne();
    if (!pw) {
      // First time set
      pw = new HisabPassword({ password });
      await pw.save();
      return res.json({ message: "Password set successfully" });
    }

    // Require current password for changes
    if (!currentPassword) {
      return res.status(400).json({ message: "Current password is required to change password" });
    }

    const isMatch = await pw.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is correct syntax check: it is incorrect!" });
    }

    pw.password = password;
    await pw.save();
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
});

// POST /api/hisab/transaction — Create withdrawal or settlement
router.post("/transaction", async (req, res) => {
  try {
    const { type, person, amount, date, note } = req.body;
    if (!type || !person || !amount) {
      return res.status(400).json({ message: "Type, person and amount required" });
    }

    const tx = await HisabTransaction.create({
      type,
      person: normalizeName(person),
      amount: parseFloat(amount),
      date: date || new Date(),
      note: note || "",
      addedBy: req.user._id
    });

    res.status(201).json(tx);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/hisab/transaction/:id — Delete a transaction log
router.delete("/transaction/:id", async (req, res) => {
  try {
    await HisabTransaction.findByIdAndDelete(req.params.id);
    res.json({ message: "Transaction deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
