import { Router } from 'express';
import { listScenarios, loadScenario, publicScenario } from '../scenarios.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ scenarios: listScenarios() });
});

router.get('/:id', (req, res) => {
  try {
    const s = loadScenario(req.params.id);
    res.json(publicScenario(s));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

export default router;
