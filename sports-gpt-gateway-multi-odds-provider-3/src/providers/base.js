import { HttpError } from '../errors.js';

export class BaseProvider {
  constructor(name) {
    this.name = name;
  }

  async listGames() {
    throw new HttpError(501, `${this.name} does not implement listGames`);
  }

  async getGame() {
    throw new HttpError(501, `${this.name} does not implement getGame`);
  }

  async listTeams() {
    throw new HttpError(501, `${this.name} does not implement listTeams`);
  }

  async getStandings() {
    throw new HttpError(501, `${this.name} does not implement getStandings`);
  }
}
