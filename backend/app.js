const express = require('express');
const mysql = require('mysql');
const app = express();
const port = 3000;

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
});

app.get('/api/name', (req, res) => {
  db.query('SELECT name FROM names', (err, results) => {
    if (err) {
      res.status(500).send(err);
    } else {
      res.json(results[0]);
    }
  });
});

app.get('/api/container-id', (req, res) => {
  res.json({ container_id: process.env.HOSTNAME });
});

app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
});

app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.end('# HELP http_requests_total Total HTTP requests\n# TYPE http_requests_total counter\nhttp_requests_total 1\n');
});