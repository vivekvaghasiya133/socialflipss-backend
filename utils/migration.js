const Content = require("../models/Content");

const runStagesMigration = async () => {
  try {
    console.log("Running Content stages migration...");
    
    const approvedResult = await Content.updateMany({ stage: "approved" }, { stage: "script" });
    const shootingResult = await Content.updateMany({ stage: "shooting" }, { stage: "shoot" });
    const editingResult = await Content.updateMany({ stage: "editing" }, { stage: "edit" });

    if (approvedResult.modifiedCount > 0 || shootingResult.modifiedCount > 0 || editingResult.modifiedCount > 0) {
      console.log(`✓ Content stages migrated successfully:
      - approved -> script: ${approvedResult.modifiedCount} updated
      - shooting -> shoot: ${shootingResult.modifiedCount} updated
      - editing -> edit: ${editingResult.modifiedCount} updated`);
    } else {
      console.log("✓ No older stage states found to migrate.");
    }
  } catch (err) {
    console.error("Migration error:", err.message);
  }
};

module.exports = runStagesMigration;
