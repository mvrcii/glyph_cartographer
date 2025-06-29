import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import routes from './routes/index.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan('dev'));

// Mount API routes under /api
app.use('/api', routes);

// 404 handler
app.use((req, res) => {
  const message = `No route for ${req.method} ${req.originalUrl}`;
  if (process.env.NODE_ENV !== 'production') {
    return res
      .status(404)
      .json({ success: false, error: message, hint: 'Check the URL – maybe /api/tiles/existing?' });
  }
  // Production: shorter, no internal hints
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Error handler
app.use((err, _req, res, _next) => {
    console.error('Server error:', err);
    res.status(500).json({success: false, error: 'Internal server error'});
});

export default app;