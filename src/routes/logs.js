import express from 'express';
import {
  addBetLogEntry,
  addPostmortem,
  deleteBetLogEntry,
  deletePostmortem,
  listBetLogEntries,
  listPostmortems,
  updateBetLogEntry,
  updatePostmortem
} from '../storage.js';

export const logsRouter = express.Router();

logsRouter.get('/bet-log', async (req, res, next) => {
  try {
    const entries = await listBetLogEntries({
      limit: req.query.limit,
      offset: req.query.offset,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      sport: req.query.sport,
      result: req.query.result
    });

    res.json({
      data: entries,
      pagination: {
        limit: Math.min(Math.max(Number(req.query.limit) || 50, 1), 100),
        offset: Math.max(Number(req.query.offset) || 0, 0),
        returned: entries.length
      }
    });
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

logsRouter.patch('/bet-log/:id', async (req, res, next) => {
  try {
    const entry = await updateBetLogEntry(
      req.params.id,
      req.body || {}
    );

    res.json({
      success: true,
      data: entry
    });
  } catch (error) {
    next(error);
  }
});

logsRouter.delete('/bet-log/:id', async (req, res, next) => {
  try {
    const deleted = await deleteBetLogEntry(req.params.id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Bet log entry not found'
      });
    }

    res.json({
      success: true,
      deleted_id: req.params.id
    });
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
logsRouter.patch('/postmortems/:id', async (req, res, next) => {
  try {
    const entry = await updatePostmortem(
      req.params.id,
      req.body || {}
    );

    res.json({
      success: true,
      data: entry
    });
  } catch (error) {
    next(error);
  }
});

logsRouter.delete('/postmortems/:id', async (req, res, next) => {
  try {
    const deleted = await deletePostmortem(req.params.id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Postmortem not found'
      });
    }

    res.json({
      success: true,
      deleted_id: req.params.id
    });
  } catch (error) {
    next(error);
  }
});
