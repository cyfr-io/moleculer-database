/* eslint-disable no-console */
'use strict';

/**
 * It's a simple example which demonstrates how to
 * use this services and make CRUD actions.
 */

const { ServiceBroker } = require('moleculer');
const { inspect } = require('util');
const DbService = require('../../index').Service;
const util = require('util');

// Create broker
const broker = new ServiceBroker({
	logger: {
		type: 'Console',
		options: {
			level: {
				POSTS: 'debug',
				'*': 'info',
			},
			objectPrinter: (obj) =>
				inspect(obj, {
					breakLength: 50,
					colors: true,
					depth: 3,
				}),
		},
	},
	metrics: {
		enabled: false,
		reporter: {
			type: 'Console',
			options: {
				includes: ['moleculer.database.**'],
			},
		},
	},

	tracing: {
		enabled: false,
		exporter: {
			type: 'Console',
		},
	},
});

// Create a service
broker.createService({
	name: 'posts',
	mixins: [
		DbService({
			adapter: {
				// type: "Knex",
				// options: {
				// 	knex: {
				// 		client: "sqlite3",
				// 		connection: {
				// 			filename: ":memory:"
				// 		}
				// 	}
				// }
				type: 'MongoDB',
			},

			createActions: {
				create: true,
				createMany: true,
				count: false,
				find: true,
				list: true,
				replace: false,
				remove: false,
				update: true,
				updateMany: true,
				remove: false,
			},
		}),
	],

	settings: {
		fields: {
			id: { type: 'string', primaryKey: true, search: true, filter: true /*, generated: "user"*/ },
			title: {
				type: 'string',
				max: 255,
				trim: true,
				required: true,
				search: true,
				filter: true,
			},
			content: { type: 'string', search: true, filter: true },
			votes: { type: 'number', integer: true, min: 0, default: 0, columnType: 'int', filter: true },
			status: { type: 'boolean', default: true },
			createdAt: {
				type: 'number',
				readonly: true,
				onCreate: () => Date.now(),
				columnType: 'double',
			},
			updatedAt: {
				type: 'number',
				readonly: true,
				onUpdate: () => Date.now(),
				columnType: 'double',
			},
		},
		indexes: [{ fields: 'content' }],
	},

	actions: {
		remove: {
			rest: {
				method: 'DELETE',
				path: '/:id',
			},
			params: {
				id: { type: 'string' },
			},
			async handler(ctx) {},
		},
	},

	async started() {
		const adapter = await this.getAdapter();
		if (adapter.createTable) await adapter.createTable();

		// for (const [key, value] of Object.entries(this._serviceSpecification.actions)) {
		// 	console.log({ rest: value.rest, params: value.params, name: value.name });
		// }

		await this.clearEntities();
	},
});

// Start server
broker
	.start()
	.then(async () => {
		// Create a new post
		let post = await broker.call('posts.create', {
			title: 'This Should Be Here 1',
			content: 'Content of my first post...',
		});

		console.log('First post:', post);

		// await broker.Promise.delay(500);

		// post = await broker.call('posts.create', {
		// 	title: 'This Should Be Here 2',
		// 	content: 'Content of my second post...',
		// 	votes: 3,
		// });
		//console.log("Second post:", post);

		post = await broker.call('posts.create', {
			title: 'This Should Get Updated 3',
			content: 'I wanna see diff this',
			status: false,
		});
		console.log('3rd post:', post);

		let cr = [];
		for (let i = 0; i < 25; i++) {
			cr.push({
				title: `${i} Numbered Post`,
				content: `Test content hello`,
				status: true,
				votes: i,
			});
		}

		let posts;
		posts = await broker.call('posts.createMany', cr);
		console.log('4. & 5. posts:', posts);

		// await broker.call('posts.updateMany', { query: { votes: 0 }, changes: { content: 'Nigga ' } });
		// Get all posts
		// posts = await broker.call('posts.find', { limit: 2, sort: '-createdAt' });
		// posts = await broker.call('posts.find', { sort: 'votes', single: true });
		// console.log('Find:', posts);

		// List posts with pagination
		// posts = await broker.call('posts.list', {
		// 	page: 1,
		// 	pageSize: 10,
		// 	// search: ['13', '12', '8'],
		// 	// searchFields: 'title',
		// 	filter: {
		// 		title: { match: '9 Num' },
		// 	},
		// });
		// console.log('List:', posts);

		// Get a post by ID
		// post = await broker.call('posts.get', { id: post.id });
		// console.log('Get:', post);

		// // // Update the post
		// post = await broker.call('posts.update', { id: post.id, title: 'Modified post' });
		// console.log('Updated:', post);

		// // Delete a user
		// const res = await broker.call('posts.remove', { id: post.id });
		// console.log('Deleted:', res);
	})
	.then(() => broker.repl())
	.catch((err) => {
		broker.logger.error(err);
		process.exit(1);
	});
