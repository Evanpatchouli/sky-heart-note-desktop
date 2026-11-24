import { Model, QueryFilter } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from './user.schema';
import { PaginatedResult } from '@webapp-template/common';

@Injectable()
export class UserModel {
  constructor(@InjectModel(User.name) private readonly model: Model<User>) {}

  getModel() {
    return this.model;
  }

  async findById(id: string) {
    return this.model.findById(id).exec();
  }

  async findByUsername(username: string) {
    return this.model.findOne({ username }).exec();
  }

  async findPage(
    page: number,
    size: number,
    filter?: QueryFilter<User>,
  ): Promise<PaginatedResult<User>> {
    const [list, total] = await Promise.all([
      this.model
        .find(filter)
        .skip((page - 1) * size)
        .limit(size)
        .populate('roles')
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      list,
      total,
      page,
      size,
      totalPages: Math.ceil(total / size),
    };
  }

  async updateById(id: string, data: Partial<User>) {
    return this.model.findByIdAndUpdate(id, data).exec();
  }
}
