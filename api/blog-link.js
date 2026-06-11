module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    url: 'https://blog.annygomez.com',
    title: 'Blog de Anny Gómez'
  });
};
