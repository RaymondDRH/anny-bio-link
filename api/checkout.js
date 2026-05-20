module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const keyAvailable = !!process.env.STRIPE_SECRET_KEY;
  const keyPrefix    = process.env.STRIPE_SECRET_KEY
    ? process.env.STRIPE_SECRET_KEY.substring(0, 12)
    : 'NOT_FOUND';

  const stripeEnvKeys = Object.keys(process.env).filter(k => k.includes('STRIPE'));

  res.status(200).json({
    debug: true,
    keyAvailable,
    keyPrefix,
    stripeEnvKeys,
  });
};
