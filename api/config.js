module.exports = (req, res) => {
  res.status(200).json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
    paypalEnv: process.env.PAYPAL_ENV || 'sandbox',
  });
};
