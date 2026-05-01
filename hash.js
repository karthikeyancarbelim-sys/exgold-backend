const bcrypt = require("bcryptjs");

const run = async () => {
  const hash = await bcrypt.hash("Exgold@2025#", 10);
  console.log(hash);
};

run();