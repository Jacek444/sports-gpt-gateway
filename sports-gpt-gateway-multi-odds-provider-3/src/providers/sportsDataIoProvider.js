import { BaseProvider } from './base.js';
import { HttpError } from '../errors.js';

export class SportsDataIoProvider extends BaseProvider {
  constructor({ apiKey, baseUrl }) {
    super('sportsdataio');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  notImplemented(methodName) {
    throw new HttpError(
      501,
      `SportsDataIO adapter method "${methodName}" is not wired yet. Map your purchased SportsDataIO feeds into this adapter without changing the GPT-facing API contract.`
    );
  }

  async listGames() {
    this.notImplemented('listGames');
  }

  async getGame() {
    this.notImplemented('getGame');
  }

  async listTeams() {
    this.notImplemented('listTeams');
  }

  async getStandings() {
    this.notImplemented('getStandings');
  }
}
