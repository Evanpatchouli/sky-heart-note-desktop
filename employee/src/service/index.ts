import type { App } from "#/types";
import type { Songxinhao } from "#/model/Songxinhao";
import { employeeRequest } from "./request";

type BookingInput = Partial<Omit<App.Booking, "id" | "created_at" | "updated_at">>;
type AccountInput = Pick<Songxinhao, "name" | "candles">;

export const getAllBooking = (signal?: AbortSignal) => employeeRequest<App.Booking[]>("bookings", "GET", undefined, signal);
export const createBooking = (data: BookingInput) => employeeRequest<number>("bookings", "POST", data);
export const updateBooking = (id: number, data: BookingInput) => employeeRequest<boolean>(`bookings/${id}`, "PATCH", data);
export const updateBookingDynamic = updateBooking;
export const deleteBooking = (id: number) => employeeRequest<boolean>(`bookings/${id}`, "DELETE");

export const getAllSongsinhao = (signal?: AbortSignal) => employeeRequest<Songxinhao[]>("songxinhao", "GET", undefined, signal);
export const createSongsinhao = (data: AccountInput) => employeeRequest<number>("songxinhao", "POST", data);
export const updateSongsinhao = (id: number, data: Partial<AccountInput>) => employeeRequest<boolean>(`songxinhao/${id}`, "PATCH", data);
export const deleteSongsinhao = (id: number) => employeeRequest<boolean>(`songxinhao/${id}`, "DELETE");
