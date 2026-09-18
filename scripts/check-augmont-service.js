const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const { augmontLogin } = require("../dist/services/augmont.service");

augmontLogin()
  .then((result) => {
    console.log(
      JSON.stringify({
        success: result.success,
        tokenAvailable: result.tokenAvailable,
        baseUrl: result.baseUrl,
      })
    );
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
