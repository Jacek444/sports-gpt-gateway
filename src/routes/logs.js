import express from 'express';
import {
  addBetLogEntry,
  addPostmortem,
  addPromo,
  deleteBetLogEntry,
  deletePostmortem,
  deletePromo,
  listBetLogEntries,
  listPostmortems,
  listPromos,
  updateBetLogEntry,
  updatePostmortem,
  updatePromo
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

logsRouter.get('/promos', async (req, res, next) => {
  try {
    const promos = await listPromos({
      limit: req.query.limit,
      offset: req.query.offset,
      status: req.query.status,
      sportsbook: req.query.sportsbook,
      promo_type: req.query.promo_type,
      expires_before: req.query.expires_before,
      expires_after: req.query.expires_after
    });

    res.json({
      data: promos,
      pagination: {
        limit: Math.min(Math.max(Number(req.query.limit) || 100, 1), 200),
        offset: Math.max(Number(req.query.offset) || 0, 0),
        returned: promos.length
      }
    });
  } catch (error) {
    next(error);
  }
});

logsRouter.post('/promos', async (req, res, next) => {
  try {
    const promo = await addPromo(req.body || {});
    res.status(201).json({ data: promo });
  } catch (error) {
    next(error);
  }
});

logsRouter.patch('/promos/:id', async (req, res, next) => {
  try {
    const promo = await updatePromo(
      req.params.id,
      req.body || {}
    );

    res.json({
      success: true,
      data: promo
    });
  } catch (error) {
    next(error);
  }
});

logsRouter.delete('/promos/:id', async (req, res, next) => {
  try {
    const deleted = await deletePromo(req.params.id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Promo not found'
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
