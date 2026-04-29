import mongoose from 'mongoose';

export async function connectDB(): Promise<void> {
  const dbUri = process.env.DBCON;
  if (!dbUri) {
    throw new Error('环境变量 DBCON 未设置');
  }
  await mongoose.connect(dbUri);
  console.log('MongoDB Atlas 连接成功');
}
