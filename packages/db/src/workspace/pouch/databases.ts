import PouchDB from "pouchdb";
import PouchDBDebug from "pouchdb-debug";
import PouchDBFind from "pouchdb-find";
import { generateId } from "@truffle/db/helpers";

import {
  CollectionDatabases,
  CollectionName,
  CollectionResult,
  Collections,
  Definition,
  Definitions,
  Input,
  Payload,
  MutableCollectionName,
  Resource
} from "./types";

export interface DatabasesOptions<C extends Collections> {
  settings: any;
  definitions: Definitions<C>;
}

/**
 * Aggegrates logic for interacting wth a set of PouchDB databases identified
 * by resource collection name.
 */
export abstract class Databases<C extends Collections> {
  private collections: CollectionDatabases<C>;
  private definitions: Definitions<C>;

  private ready: Promise<void>;

  constructor(options: DatabasesOptions<C>) {
    this.setup(options);

    this.definitions = options.definitions;

    PouchDB.plugin(PouchDBDebug);
    PouchDB.plugin(PouchDBFind);

    this.collections = Object.keys(options.definitions)
      .map((resource: CollectionName<C>) => ({
        [resource]: this.createDatabase(resource)
      }))
      .reduce((a, b) => ({ ...a, ...b }), {}) as CollectionDatabases<C>;

    this.ready = this.initialize();
  }

  protected setup(_) {}

  protected abstract createDatabase(
    resource: CollectionName<C>
  ): PouchDB.Database;

  private async initialize() {
    await Promise.all(
      Object.entries(this.definitions).map(([collectionName, definition]) =>
        this.initializeCollection(collectionName, definition)
      )
    );
  }

  private async initializeCollection<N extends CollectionName<C>>(
    collectionName: N,
    definition: Definition<C, N>
  ) {
    const collection = this.collections[collectionName];

    const { createIndexes } = definition;

    for (let index of createIndexes || []) {
      await collection.createIndex({ index });
    }
  }

  public async all<N extends CollectionName<C>>(
    collectionName: N
  ): Promise<CollectionResult<C, N>> {
    return await this.find<N>(collectionName, { selector: {} });
  }

  public async find<N extends CollectionName<C>>(
    collectionName: N,
    options: PouchDB.Find.FindRequest<{}>
  ): Promise<CollectionResult<C, N>> {
    await this.ready;

    // allows searching with `id` instead of pouch's internal `_id`,
    // since we call the field `id` externally, and this approach avoids
    // an extra index
    const fixIdSelector = selector =>
      Object.entries(selector)
        .map(([field, predicate]) =>
          field === "id" ? { _id: predicate } : { [field]: predicate }
        )
        .reduce((a, b) => ({ ...a, ...b }), {});

    try {
      const { docs }: any = await this.collections[collectionName].find({
        ...options,
        selector: fixIdSelector(options.selector)
      });

      // make sure we include `id` in the response as well
      return docs.map(doc => ({ ...doc, id: doc["_id"] }));
    } catch (error) {
      console.log(`Error fetching all ${collectionName}\n`);
      console.log(error);
      return ([] as unknown) as CollectionResult<C, N>;
    }
  }

  public async get<N extends CollectionName<C>>(
    collectionName: N,
    id: string
  ): Promise<Resource<C, N> | null> {
    await this.ready;

    try {
      const result = await this.collections[collectionName].get(id);
      return {
        ...result,
        id
      } as Resource<C, N>;
    } catch (_) {
      return null;
    }
  }

  public async add<N extends CollectionName<C>>(
    collectionName: N,
    input: Input<C, N>
  ): Promise<Payload<C, N>> {
    await this.ready;

    const resources = await Promise.all(
      input[collectionName].map(async resourceInput => {
        const id = this.generateId(collectionName, resourceInput);

        // check for existing
        const resource = await this.get(collectionName, id);
        if (resource) {
          return resource;
        }

        await this.collections[collectionName].put({
          ...resourceInput,
          _id: id
        });

        return {
          ...resourceInput,
          id
        } as Resource<C, N>;
      })
    );

    return ({
      [collectionName]: resources
    } as unknown) as Payload<C, N>;
  }

  public async update<M extends MutableCollectionName<C>>(
    collectionName: M,
    input: Input<C, M>
  ): Promise<Payload<C, M>> {
    await this.ready;

    const resources = await Promise.all(
      input[collectionName].map(async resourceInput => {
        const id = this.generateId(collectionName, resourceInput);

        // check for existing
        const resource = await this.get(collectionName, id);
        const { _rev }: any = resource ? resource : {};

        await this.collections[collectionName].put({
          ...resourceInput,
          _rev,
          _id: id
        });

        return {
          ...resourceInput,
          id
        } as Resource<C, M>;
      })
    );

    return ({
      [collectionName]: resources
    } as unknown) as Payload<C, M>;
  }

  public async remove<M extends MutableCollectionName<C>>(
    collectionName: M,
    input: Input<C, M>
  ): Promise<void> {
    await this.ready;

    await Promise.all(
      input[collectionName].map(async resourceInput => {
        const id = this.generateId(collectionName, resourceInput);

        const resource = await this.get(collectionName, id);
        const { _rev }: any = resource ? resource : {};

        if (_rev) {
          await this.collections[collectionName].put({
            _rev,
            _id: id,
            _deleted: true
          });
        }
      })
    );
  }

  private generateId<N extends CollectionName<C>>(
    collectionName: N,
    input: Input<C, N>[N][number]
  ): string {
    const { idFields } = this.definitions[collectionName];

    return generateId(
      idFields.reduce(
        (obj, field) => ({
          ...obj,
          [field]: input[field]
        }),
        {}
      )
    );
  }
}
