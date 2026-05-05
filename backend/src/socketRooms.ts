import type mongoose from 'mongoose';

export function storeIoRoom(storeId: mongoose.Types.ObjectId): string {
  return `store:${storeId.toString()}`;
}
