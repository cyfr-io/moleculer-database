/*
 * @moleculer/database
 * Copyright (c) 2022 MoleculerJS (https://github.com/moleculerjs/database)
 * MIT Licensed
 */

'use strict';
const util = require('util');
const _ = require('lodash');
const { flatten } = require('../utils');
const BaseAdapter = require('./base');
const Snowflake = require('../snowflake'); // Import the Snowflake class

let MongoClient, ObjectId, SnowflakeId;

class MongoDBAdapter extends BaseAdapter {
	/**
	 * Constructor of adapter.
	 *
	 * @param  {Object?} opts
	 * @param  {String?} opts.dbName
	 * @param  {String?} opts.collection
	 * @param  {Object?} opts.mongoClientOptions More Info: https://mongodb.github.io/node-mongodb-native/4.1/interfaces/MongoClientOptions.html
	 * @param  {Object?} opts.dbOptions More Info: https://mongodb.github.io/node-mongodb-native/4.1/interfaces/DbOptions.html
	 */
	constructor(opts) {
		if (_.isString(opts)) opts = { uri: opts };

		super(opts);

		this.client = null;
		this.db = null;
	}

	/**
	 * The adapter has nested-field support.
	 */
	get hasNestedFieldSupport() {
		return true;
	}

	/**
	 * Initialize the adapter.
	 *
	 * @param {Service} service
	 */
	init(service) {
		super.init(service);

		if (!this.opts.collection) {
			this.opts.collection = service.name;
		}

		try {
			MongoClient = require('mongodb').MongoClient;
			ObjectId = require('mongodb').ObjectId;
		} catch (err) {
			/* istanbul ignore next */
			this.broker.fatal("The 'mongodb' package is missing! Please install it with 'npm install mongodb --save' command.", err, true);
		}

		SnowflakeId = new Snowflake({
			instanceId: this.broker.instanceId,
		});

		this.checkClientLibVersion('mongodb', '^4.0.0');
	}

	/**
	 * Connect adapter to database
	 */
	async connect() {
		const uri = this.opts.uri || 'mongodb://localhost:27017';

		this.storeKey = `mongodb|${uri}`;
		this.client = this.getClientFromGlobalStore(this.storeKey);
		if (!this.client) {
			this.logger.debug(`MongoDB adapter is connecting to '${uri}'...`);
			this.client = new MongoClient(uri, this.opts.mongoClientOptions);

			this.logger.debug('Store the created MongoDB client', this.storeKey);
			this.setClientToGlobalStore(this.storeKey, this.client);

			this.client.on('open', () => this.logger.info(`MongoDB client has connected.`));
			this.client.on('close', () => this.logger.warn('MongoDB client has disconnected.'));
			this.client.on('error', (err) => this.logger.error('MongoDB error.', err));
			try {
				// Connect the client to the server
				await this.client.connect();
			} catch (err) {
				// We remove the client from the global store if the connection failed because of reconnecting
				this.removeAdapterFromClientGlobalStore(this.storeKey);
				throw err;
			}
		} else {
			this.logger.debug('Using an existing MongoDB client', this.storeKey);
			if (!this.client.topology || !this.client.topology.isConnected()) {
				this.logger.debug('Waiting for the connected state of MongoDB client...');
				// This silent timer blocks the process to avoid exiting while wait for connecting
				const emptyTimer = setInterval(() => {}, 1000);
				await new this.Promise((resolve) => {
					this.client.once('open', () => {
						clearInterval(emptyTimer);
						resolve();
					});
				});
			}
		}

		if (this.opts.dbName) {
			// Select DB and verify connection
			this.logger.debug('Selecting database:', this.opts.dbName);
			this.db = this.client.db(this.opts.dbName, this.opts.dbOptions);
		} else {
			// Using database from connection URI
			this.db = this.client.db();
		}
		await this.db.command({ ping: 1 });
		this.logger.debug('Database selected successfully.');

		this.logger.debug('Open collection:', this.opts.collection);
		this.collection = this.db.collection(this.opts.collection);

		this.connected();
	}

	/**
	 * On successful database connection
	 */
	async connected() {
		const serviceIndexes = [];

		if (this.service.settings.indexes) {
			serviceIndexes.push(this.service.settings.indexes);
		}

		if (this.service.$primaryField?.generated !== 'user') {
			const columnName = this.service.$primaryField.columnName;
			serviceIndexes.push({ fields: columnName, unique: true, name: `${columnName}_primary` });
		}

		try {
			const existingIndexes = await this.collection.indexes();
			const toCreateIndexes = serviceIndexes.filter((item) => !existingIndexes.some((exist) => exist.name === item.name));
			await this.service.createIndexes(null, toCreateIndexes);
		} catch (error) {
			if (error.codeName === 'NamespaceNotFound') {
				return this.logger.warn('Did not create indexes for non-existant collection ' + this.opts.collection);
			}
			throw error;
		}
	}

	/**
	 * Disconnect adapter from database
	 */
	async disconnect() {
		if (this.client) {
			if (this.removeAdapterFromClientGlobalStore(this.storeKey)) await this.client.close();
		}
	}

	/**
	 * Find all entities by filters.
	 *
	 * @param {Object} params
	 * @returns {Promise<Array>}
	 */
	find(params) {
		return this.createQuery(params).toArray();
	}

	/**
	 * Find an entity by query & sort
	 *
	 * @param {Object} params
	 * @returns {Promise<Object>}
	 */
	async findOne(params) {
		if (params.sort) {
			const res = await this.find(params);
			return res.length > 0 ? res[0] : null;
		} else {
			const query = this.parseParams(params);
			return this.collection.findOne(query);
		}
	}

	/**
	 * Find an entities by ID.
	 *
	 * @param {String|ObjectId} id
	 * @returns {Promise<Object>} Return with the found document.
	 *
	 */
	findById(id) {
		return this.collection.findOne({ id });
	}

	/**
	 * Find entities by IDs.
	 *
	 * @param {Array<String|ObjectId>} idList
	 * @returns {Promise<Array>} Return with the found documents in an Array.
	 *
	 */
	findByIds(idList) {
		return this.collection
			.find({
				id: {
					$in: idList,
				},
			})
			.toArray();
	}

	/**
	 * Find all entities by filters and returns a Stream.
	 *
	 * @param {Object} params
	 * @returns {Promise<Stream>}
	 */
	findStream(params) {
		return this.createQuery(params).stream();
	}

	/**
	 * Get count of filtered entites.
	 *
	 * @param {Object} [params]
	 * @returns {Promise<Number>} Return with the count of documents.
	 *
	 */
	count(params) {
		return this.createQuery(params, { counting: true });
	}

	/**
	 * Insert an entity.
	 *
	 * @param {Object} entity
	 * @returns {Promise<Object>} Return with the inserted document.
	 *
	 */
	async insert(entity) {
		try {
			const e = this.addIdToEntity(entity);
			const res = await this.collection.insertOne(e);
			if (!res.acknowledged) throw new Error('MongoDB insertOne failed.');
			return e;
		} catch (error) {
			throw new Error('Creating Record Failed');
		}
	}

	/**
	 * Insert many entities
	 *
	 * @param {Array<Object>} entities
	 * @param {Object?} opts
	 * @param {Boolean?} opts.returnEntities
	 * @returns {Promise<Array<Object|any>>} Return with the inserted IDs or entities.
	 *
	 */
	async insertMany(entities, opts = {}) {
		const remappedEntities = entities.map((entity) => this.addIdToEntity(entity));
		try {
			const res = await this.collection.insertMany(remappedEntities);
			if (!res.acknowledged) throw new Error('MongoDB insertMany failed.');
			return opts.returnEntities ? entities : Object.values(res.insertedIds);
		} catch (error) {
			throw new Error('Creating Many Records Failed');
		}
	}

	/**
	 * Update an entity by ID
	 *
	 * @param {String} id
	 * @param {Object} changes
	 * @param {Object} opts
	 * @returns {Promise<Object>} Return with the updated document.
	 *
	 */
	async updateById(id, changes, opts) {
		const raw = opts && opts.raw ? true : false;
		if (!raw) {
			// Flatten the changes to dot notation
			changes = flatten(changes, { safe: true });
		}

		const res = await this.collection.findOneAndUpdate({ id }, raw ? changes : { $set: changes }, { returnDocument: 'after' });
		return res.value;
	}

	/**
	 * Update many entities
	 *
	 * @param {Object} query
	 * @param {Object} changes
	 * @param {Object} opts
	 * @returns {Promise<Number>} Return with the count of modified documents.
	 *
	 */
	async updateMany(query, changes, opts) {
		const raw = opts && opts.raw ? true : false;
		if (!raw) {
			// Flatten the changes to dot notation
			changes = flatten(changes, { safe: true });
		}

		const res = await this.collection.updateMany(query, raw ? changes : { $set: changes });
		return res.modifiedCount;
	}

	/**
	 * Replace an entity by ID
	 *
	 * @param {String} id
	 * @param {Object} entity
	 * @returns {Promise<Object>} Return with the updated document.
	 *
	 */
	async replaceById(id, entity) {
		const e = { id, ...entity };
		const res = await this.collection.findOneAndReplace({ id }, e, {
			returnDocument: 'after',
		});
		return res.value;
	}

	/**
	 * Remove an entity by ID
	 *
	 * @param {String} id
	 * @returns {Promise<any>} Return with ID of the deleted document.
	 *
	 */
	async removeById(id) {
		await this.collection.findOneAndDelete({ id });
		return id;
	}

	/**
	 * Remove entities which are matched by `query`
	 *
	 * @param {Object} query
	 * @returns {Promise<Number>} Return with the number of deleted documents.
	 *
	 */
	async removeMany(query) {
		const res = await this.collection.deleteMany(query);
		return res.deletedCount;
	}

	/**
	 * Clear all entities from collection
	 *
	 * @returns {Promise<Number>}
	 *
	 */
	async clear() {
		const res = await this.collection.deleteMany({});
		return res.deletedCount;
	}

	/**
	 * Convert DB entity to JSON object.
	 *
	 * @param {Object} entity
	 * @returns {Object}
	 */
	entityToJSON(entity) {
		let json = Object.assign({}, entity);
		return json;
	}

	/**
	 * Create a query based on filters
	 *
	 * Available filters:
	 *  - search
	 *  - searchFields
	 * 	- sort
	 * 	- limit
	 * 	- offset
	 *  - query
	 *
	 * @param {Object} params
	 * @param {Object?} opts
	 * @param {Boolean?} opts.counting
	 * @returns {Query}
	 * @memberof MemoryDbAdapter
	 */
	createQuery(params, opts = {}) {
		const fn = opts.counting ? this.collection.countDocuments : this.collection.find;
		let q;

		if (params) {
			const query = this.parseParams(params);
			q = fn.call(this.collection, query);

			// Sort
			if (!opts.counting && params.sort && q.sort) {
				const sort = this.transformSort(params.sort);
				if (sort) q.sort(sort);

				// Collation
				// https://docs.mongodb.com/manual/reference/method/cursor.collation/
				if (params.collation) q.collation(params.collation);
			}

			if (!opts.counting) {
				// Offset
				if (_.isNumber(params.offset) && params.offset > 0) q.skip(params.offset);

				// Limit
				if (_.isNumber(params.limit) && params.limit > 0) q.limit(params.limit);
			}

			// Hint
			// https://docs.mongodb.com/manual/reference/method/cursor.hint/
			if (params.hint) q.hint(params.hint);

			return q;
		}

		// If not params
		return fn.call(this.collection, {});
	}

	/**
	 * Checks if need to add anything to entity
	 * @returns {string} id
	 */
	addIdToEntity(entity) {
		if (this.service.$primaryField?.generated !== 'user') {
			const columnName = this.service.$primaryField.columnName;
			entity = {
				[columnName]: SnowflakeId.generate().toString(),
				...entity,
			};
		}
		return entity;
	}

	/**
	 * Convert the `sort` param to a `sort` object to Mongo queries.
	 *
	 * @param {String|Array<String>|Object} paramSort
	 * @returns {Object} Return with a sort object like `{ "votes": 1, "title": -1 }`
	 * @memberof MongoDbAdapter
	 */
	transformSort(sort) {
		if (typeof sort == 'string') sort = [sort];
		if (Array.isArray(sort)) {
			return sort.reduce((res, s) => {
				if (s.startsWith('-')) res[s.slice(1)] = -1;
				else res[s] = 1;
				return res;
			}, {});
		}

		return sort;
	}

	processSearchParams(search, searchFields) {
		if (!search || search.length === 0) {
			return [];
		}

		const isFieldSearchable = (field) => field.search && (!searchFields || searchFields.includes(field.name) || searchFields.length === 0);

		const searchInFields = this.service.$fields.filter(isFieldSearchable).flatMap(({ name, type, properties }) =>
			type === 'object' && properties
				? Object.entries(properties)
						.filter(([, prop]) => prop.search)
						.map(([propName, prop]) => ({ ...prop, name: `${name}.${propName}` }))
				: { name, type },
		);

		const searchQueries = searchInFields.map(({ name, type }) => this.buildStandardMatch(name, search, type));

		return searchQueries.length ? [{ $or: searchQueries }] : [];
	}

	parseParams(params) {
		const { filter, search, searchFields, query } = params;

		console.log(util.inspect(params, false, null, true /* enable colors */));

		let cq = [];
		cq.push(...this.processSearchParams(search, searchFields));
		cq.push(...this.processFilterParams(filter));
		if (query) cq.push(query);

		cq = cq.length > 0 ? { $and: cq } : {};
		console.log(util.inspect(cq, false, null, true /* enable colors */));

		return cq;
	}

	processFilterParams(filter) {
		if (!filter) return [];

		return Object.entries(filter).reduce((queryAccumulator, [field, valueObj]) => {
			if (!this.service.$fields.some(({ name, filter }) => filter && name === field) || valueObj === '') {
				// Skip fields that are not allowed for filtering or have empty values
				return queryAccumulator;
			}

			const { isMatch, values } = valueObj;
			const buildMethod = isMatch ? this.buildStandardMatch : this.buildStandardStrict;
			const valuesToProcess = isMatch ? values : valueObj;
			// Ensure we're not processing empty strings unless intentionally handled
			if (valuesToProcess === '' && !isMatch) return queryAccumulator;

			const processedValues = Array.isArray(valuesToProcess)
				? valuesToProcess.map((value) => buildMethod(field, value, typeof value)).filter((query) => query !== undefined && query !== null)
				: [buildMethod(field, valuesToProcess, typeof valuesToProcess)].filter((query) => query !== undefined && query !== null);

			// Only add non-undefined, valid query objects
			if (processedValues.length > 1) {
				queryAccumulator.push({ $or: processedValues });
			} else if (processedValues.length === 1) {
				queryAccumulator.push(processedValues[0]);
			}

			return queryAccumulator;
		}, []);
	}

	buildStandardMatch(field, values, type = null) {
		const regexPattern = Array.isArray(values) ? values.map((value) => `(${value})`).join('|') : values;
		return type === 'number'
			? {
					$expr: {
						$regexMatch: {
							input: { $toString: `$${field}` },
							regex: `.*${regexPattern}.*`,
							options: 'i',
						},
					},
			  }
			: { [field]: { $regex: `.*${regexPattern}.*`, $options: 'i' } };
	}

	buildStandardStrict(field, value, type = null) {
		return type === 'number' ? { $expr: { input: { $toString: `$${field}` } } } : { [field]: value };
	}

	/**
	 * Create an index.
	 *
	 * @param {Object} def
	 * @param {String|Array<String>|Object} def.fields
	 * @param {String?} def.name
	 * @param {Boolean?} def.unique
	 * @param {Boolean?} def.sparse
	 * @param {Number?} def.expireAfterSeconds
	 */
	async createIndex(def) {
		let fields;
		if (typeof def.fields == 'string') fields = { [def.fields]: 1 };
		else if (Array.isArray(def.fields)) {
			fields = def.fields.reduce((a, b) => {
				a[b] = 1;
				return a;
			}, {});
		} else {
			fields = def.fields;
		}
		try {
			return await this.collection.createIndex(fields, def);
		} catch (err) {
			console.log(def);
			this.logger.warn(`Unable to create default Mongo index for collection ${this.opts.collection} with fields "${def.fields}"`);
			return false;
		}
	}

	/**
	 * Remove an index by name or fields.
	 *
	 * @param {Object} def
	 * @param {String|Array<String>|Object} def.fields
	 * @param {String?} def.name
	 * @returns {Promise<void>}
	 */
	async removeIndex(def) {
		if (def.name) return await this.collection.dropIndex(def.name);
		else return await this.collection.dropIndex(def.fields);
	}
}

module.exports = MongoDBAdapter;
