require("dotenv").config();

const { augmontGetRates, augmontLogin } = require("../dist/services/augmont.service");

augmontLogin()
  .then(async (result) => {
    const rates = await augmontGetRates().catch((error) => ({
      error: error.message,
    }));
    console.log(JSON.stringify({
      success: result.success,
      tokenAvailable: result.tokenAvailable,
      baseUrl: result.baseUrl,
      ratesAvailable: !rates.error,
      rateKeys: rates && typeof rates === "object" ? Object.keys(rates).slice(0, 8) : [],
      rateError: rates.error,
    }));
  })
  .catch((error) => {
    console.log(JSON.stringify({
      success: false,
      message: error.message,
    }));
    process.exitCode = 1;
  });
