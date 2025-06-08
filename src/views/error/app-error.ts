export type AppErrorID = "404";

export class AppError extends Error {
  public name: string = "AppError";
  public id?: AppErrorID;
  public statusText?: string;
  public status?: number;

  constructor(message: string, id?: AppError["id"]) {
    super(message);
    this.id = id;
  }
}
