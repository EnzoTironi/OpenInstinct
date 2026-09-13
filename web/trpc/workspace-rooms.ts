import { Schema } from "effect";
import { serverRuntime } from "../../server/runtime";
import { workspaceProcedure } from "./workspace-procedure";
import {
  MatrixCreateInput,
  MatrixMessageInput,
  MatrixRoomInput,
  closeMatrixRoom,
  createMatrixRoom,
  listMatrixRooms,
  readMatrixMessages,
  sendMatrixMessage,
} from "../../server/matrix/rooms";

export const workspaceRoomsRouter = {
  list: workspaceProcedure.query(({ ctx, signal }) =>
    serverRuntime.runPromise(listMatrixRooms(ctx.actor), { signal })
  ),
  create: workspaceProcedure
    .input(Schema.toStandardSchemaV1(MatrixCreateInput))
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(createMatrixRoom(ctx.actor, input), { signal })
    ),
  messages: workspaceProcedure
    .input(Schema.toStandardSchemaV1(MatrixRoomInput))
    .query(({ ctx, input, signal }) =>
      serverRuntime.runPromise(readMatrixMessages(ctx.actor, input.id), {
        signal,
      })
    ),
  send: workspaceProcedure
    .input(Schema.toStandardSchemaV1(MatrixMessageInput))
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(sendMatrixMessage(ctx.actor, input), { signal })
    ),
  close: workspaceProcedure
    .input(Schema.toStandardSchemaV1(MatrixRoomInput))
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(closeMatrixRoom(ctx.actor, input.id), { signal })
    ),
};
