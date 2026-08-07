// Valida un código y devuelve el precio (en centavos). NO expone la lista de códigos.
const CODES = {};
// Código de prueba LIVE de $1: ACTIVO solo si existe la env var LIVE_TEST_CODE.
if (process.env.LIVE_TEST_CODE) CODES[String(process.env.LIVE_TEST_CODE).trim().toUpperCase()] = 100;
const BASE_AMOUNT = 69700; // $697 (precio original)

module.exports = (req, res) => {
  const code = (req.query && req.query.code) ? String(req.query.code).trim().toUpperCase() : '';
  const has = Object.prototype.hasOwnProperty.call(CODES, code);
  res.status(200).json({ valid: has, amount: has ? CODES[code] : BASE_AMOUNT });
};
