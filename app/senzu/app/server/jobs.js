const express = require('express');

const jobs = [];

function createJobsRouter() {
  const router = express.Router();

  router.get('/', (req, res) => {
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    res.json({ jobs: jobs.slice(-limit).reverse() });
  });

  router.get('/:id', (req, res) => {
    const job = jobs.find(j => j.job_id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  });

  router.post('/', (req, res) => {
    const { type, params } = req.body || {};
    if (!type) return res.status(400).json({ error: 'Missing job type' });

    const job = {
      job_id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      status: 'pending',
      created_at: Date.now(),
      params,
    };
    jobs.push(job);
    res.json({ job_id: job.job_id, status: 'pending' });
  });

  return { router, jobs };
}

module.exports = { createJobsRouter };
