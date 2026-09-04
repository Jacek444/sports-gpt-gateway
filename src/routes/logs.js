import express from 'express';
import {
  addBetLogEntry,
  addPostmortem,
  deleteBetLogEntry,
  listBetLogEntries,
  listPostmortems
} from '../storage.js';

export const logsRouter = express.Router();

logsRouter.get('/bet-log', async (req, res, next) => {
  try {
    const entries = await listBetLogEntries();
    res.json({ data: entries });
  } catch (error) {
    next(error);
  }
});

logsRouter.post('/bet-log', async (req, res, next) => {
  try {
    const entry = await addBetLogEntry(req.body || {});
    res.status(201).json({ data: entry });
  } catch (error) {
    next(error);
  }
});

logsRouter.get('/postmortems', async (req, res, next) => {
  try {
    const entries = await listPostmortems();
    res.json({ data: entries });
  } catch (error) {
    next(error);
  }
});

logsRouter.post('/postmortems', async (req, res, next) => {
  try {
    const entry = await addPostmortem(req.body || {});
    res.status(201).json({ data: entry });
  } catch (error) {
    next(error);
  }
});
