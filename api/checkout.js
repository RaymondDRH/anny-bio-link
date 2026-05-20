const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Next Fly Academy',
              description: 'Tu boleto para despegar tu marca y ganar dinero online',
            },
            unit_amount: 49700, // $497.00 in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      billing_address_collection: 'required',
      success_url: 'https://annygomez.com/next-fly-academy/success.html',
      cancel_url: 'https://annygomez.com/next-fly-academy/',
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Stripe error:', error.message);
    res.status(500).json({ error: 'Error al crear la sesión de pago' });
  }
};
