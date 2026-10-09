import 'dotenv/config';

export async function callML(path, body) {
  const base = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';
  const timeout = Number(process.env.ML_TIMEOUT_MS || 15000);
  const response = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(Number.isFinite(timeout) && timeout > 0 ? timeout : 15000),
  });
  if (!response.ok) {
    const error = new Error('ML service is unavailable or its model is not ready');
    error.statusCode = response.status === 422 ? 400 : 503;
    throw error;
  }
  return response.json();
}

export async function rankCandidates(candidates) {
  try {
    const result = await callML('/rank', { candidates });
    if (!Array.isArray(result.scores) || result.scores.length !== candidates.length ||
        result.scores.some(score => typeof score !== 'number' || !Number.isFinite(score))) {
      throw new Error('Invalid ranking response');
    }
    return { scores: result.scores, source: 'xgboost', modelVersion: result.modelVersion };
  } catch {
    return {
      scores: candidates.map(candidate => candidate.features.heuristicScore),
      source: 'geometric',
      modelVersion: null,
    };
  }
}
