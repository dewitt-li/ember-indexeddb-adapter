/*global Ember*/
/*global DS*/
'use strict';

DS.IndexedDBAdapter = DS.Adapter.extend({
  databaseName: 'IDBAdapter',
  databaseVersion:1,
  databaseTables:{},
  db:null,
  /**
   * IndexedDB requires that the database is initialized and have a defined
   * schema. It's not like localStorage, where you just store things. You have
   * to define beforehand what Object Stores you want (e.g User, Post etc).
   *
   * @method init
   */
  init: function() {
    this._super();
    var db = new Dexie(this.get("databaseName"));
    db.version(this.get("databaseVersion")).stores(this.get("databaseTables"));
    db.open().catch(function(error){
      console.log("Error when openning IndexDB:"+error);
    });
    this.set("db",db);
  },

  
  /**
   * This methods is used by the store to retrieve one record by ID.
   *
   * @method serialize
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object|String|Integer|null} id
   * @param {Object|null} opts
   */
  findRecord: function (store, type, id, opts) {
    var adapter = this;
    var allowRecursive = this.allowRecursive(opts,true);
    var relationships = this.getRelationships(type,opts);
    return this.get("db")[type.modelName].get(id).then(function(record){
      if(record){
        if (allowRecursive) {
          return adapter.loadRelationships(type, record, relationships).then(function(finalRecord) {
            return Ember.run(function() {
              adapter.cleanLostRelationshipsReferences(store, type, finalRecord);
              return Ember.RSVP.resolve(finalRecord);
            });
          });
        } else {
            return Ember.RSVP.resolve(record);
        }
      }else{
        return Ember.RSVP.reject("Failed to find a "+type.modelName+" with id "+id);
      }
    });
  },

  /**
   * Retrieves many records from the database.
   *
   * @method findMany
   * @private
   * @param {DS.Store} store
   * @param {DS.Model} type the model that we're retrieving
   * @param {Array} ids ids of the records we want to be returned.
   */
  findMany: function (store, type, ids, opts) {
    var adapter = this;
    var allowRecursive = this.allowRecursive(opts,true);
    var relationships = this.getRelationships(type,opts);
    return this.get("db")[type.modelName].where("id").anyOf(ids).toArray().then(function(records){
      if (allowRecursive) {
        return adapter.loadRelationshipsForMany(type, records, relationships);
      } else {
          return Ember.RSVP.resolve(records);
      }
    });
  },

  /**
   * Retrieves many records from the database according to the query.
   *
   * For example, we could do:
   *
   *     store.findQuery('customer', {name: /rambo|braddock/})
   *
   * @method findQuery
   * @private
   * @param {DS.Store} store
   * @param {DS.Model} type the model
   * @param {Object} query object with fields we want to look for
   */
  query: function (store, type, query) {
    var adapter = this;
    var allowRecursive = this.allowRecursive(opts,true);
    var relationships = this.getRelationships(type);
    return this.get("db")[type.modelName].filter(function(value){
      for (var field in query) {
        if(query[field]!==value[field]){
          return false;
        }
      }
      return true;
    }).toArray().then(function(records){
      if(allowRecursive){
        return adapter.loadRelationshipsForMany(store, type, records, relationships);
      }else{
        return Ember.RSVP.resolve(records);
      }
    });
  },


  /**
   * Returns all records of a given type.
   *
   * @method findAll
   * @private
   * @param {DS.Store} store
   * @param {DS.Model} type
   */
  findAll: function (store, type,sinceToken,opts) {
    var adapter = this;
    var allowRecursive = this.allowRecursive(opts.adapterOptions,false);
    var relationships = this.getRelationships(type,opts.adapterOptions);
    return this.get("db")[type.modelName].toArray().then(function(records){
      if(allowRecursive){
        return adapter.loadRelationshipsForMany(store, type, records, relationships);
      }else{
        return Ember.RSVP.resolve(records);
      }
    });
  },

  /**
   * Creates a record in the database.
   *
   * For example,
   *
   * ```js
   * store.createRecord('user', {name: "Rambo"})
   * ```
   *
   * @method createRecord
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object} record
   */
  createRecord: function (store, type, snapshot) {
    var adapter=this;
    var table=this.get("db")[type.modelName];
    var serialized = this.serialize(snapshot,{includeId:!table.schema.primKey.auto});
    return table.add(serialized).then(function(){
      return adapter.loadRelationships(store,type,serialized);
    });
  },

  /**
   *
   * @method updateRecord
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object} snapshot
   */
  updateRecord: function (store, type, snapshot) {
    var adapter=this;
    var table=this.get("db")[type.modelName];
    var serialized = this.serialize(snapshot,{includeId:!table.schema.primKey.auto});
    return table.put(serialized).then(function(){
      return Ember.RSVP.resolve(serialized);
    });
  },

  /**
   *
   * @method deleteRecord
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object} snapshot
   */
  deleteRecord: function (store, type, snapshot) {
    return this.get("db")[type.modelName].delete(snapshot.id).then(function(){
      return Ember.RSVP.resolve(serialized);
    });
  },

  /**
   * Generates a random number. You will usually want to implement UUID in your
   * app and redefine this method.
   *
   * @method generateIdForRecord
   * @private
   */
  previousGeneratedId:1,
  generateIdForRecord: function() {
    var date = Date.now();
    if (date <= this.previousGeneratedId) {
        date = ++this.previousGeneratedId;
    } else {
        this.previousGeneratedId = date;
    }
    return date;
  },

  /**
   * This takes a record, then analyzes the model relationships and replaces
   * ids with the actual values.
   *
   * Consider the following JSON is entered:
   *
   * ```js
   * {
   *   "id": 1,
   *   "title": "Rails Rambo",
   *   "comments": [1, 2]
   * }
   *
   * This will return:
   *
   * ```js
   * {
   *   "id": 1,
   *   "title": "Rails Rambo",
   *   "comments": [1, 2]
   *
   *   "_embedded": {
   *     "comment": [{
   *       "_id": 1,
   *       "comment_title": "FIRST"
   *     }, {
   *       "_id": 2,
   *       "comment_title": "Rails is unagi"
   *     }]
   *   }
   * }
   *
   * This way, whenever a resource returned, its relationships will be also
   * returned.
   *
   * @method loadRelationships
   * @private
   * @param {DS.Model} type
   * @param {Object} record
   */
  loadRelationships: function(store, type, record,relationships) {
    var adapter = this;
    var resultJSON = {},
        modelName = type.modelName,
        relationshipPromises = [];
    relationships.forEach(function(relationName) {
      var relationModel = type.typeForRelationship(relationName,store),
          relationEmbeddedId = record[relationName],
          relationProp  = adapter.relationshipProperties(type, relationName),
          relationType  = relationProp.kind,
          foreignAdapter = store.adapterFor(relationName),
          promise, embedPromise;
      var opts = {allowRecursive: false};

      if(relationType == 'hasMany'){
          var query = {};
          query[modelName]=record.id;
          promise = adapter.query(store, relationModel, query, opts);
        }else if (relationType === 'belongsTo' || relationType === 'hasOne') {
          promise = adapter.findRecord(store, relationModel, relationEmbeddedId, opts);
      } 

      embedPromise=promise.then(function(relationRecord) {
          return Ember.RSVP.resolve(adapter.addEmbeddedPayload(record, relationName, relationRecord));
      });
      relationshipPromises.push(embedPromise);
    });
    return Ember.RSVP.all(relationshipPromises).then(function() {
        return Ember.RSVP.resolve(record);
      });;
  },

  /**
   * Given the following payload,
   *
   *   {
   *      cart: {
   *        id: "1",
   *        customer: "2"
   *      }
   *   }
   *
   * With `relationshipName` being `customer` and `relationshipRecord`
   *
   *   {id: "2", name: "Rambo"}
   *
   * This method returns the following payload:
   *
   *   {
   *      cart: {
   *        id: "1",
   *        customer: "2"
   *      },
   *      _embedded: {
   *        customer: {
   *          id: "2",
   *          name: "Rambo"
   *        }
   *      }
   *   }
   *
   * which is then treated by the serializer later.
   *
   * @method addEmbeddedPayload
   * @private
   * @param {Object} payload
   * @param {String} relationshipName
   * @param {Object} relationshipRecord
   */
  addEmbeddedPayload: function(payload, relationshipName, relationshipRecord) {
    var objectHasId = (relationshipRecord && relationshipRecord.id),
        arrayHasIds = (relationshipRecord.length && relationshipRecord.isEvery("id")),
        isValidRelationship = (objectHasId || arrayHasIds);

    if (isValidRelationship) {
      if (!payload['_embedded']) {
        payload['_embedded'] = {}
      }

      payload['_embedded'][relationshipName] = relationshipRecord;
      if (relationshipRecord.length) {
        payload[relationshipName] = relationshipRecord.mapBy('id');
      } else {
        payload[relationshipName] = relationshipRecord.id;
      }
    }

    if (Ember.isArray(payload[relationshipName])) {
      payload[relationshipName] = payload[relationshipName].filter(function(id) {
        return id;
      });
    }

    return payload;
  },
  /**
   * Same as `loadRelationships`, but for an array of records.
   *
   * @method loadRelationshipsForMany
   * @private
   * @param {DS.Model} type
   * @param {Object} recordsArray
   */
  loadRelationshipsForMany: function(store, type, recordsArray, relationships) {
    var adapter = this;

    return new Ember.RSVP.Promise(function(resolve, reject) {
      var recordsWithRelationships = [],
          recordsToBeLoaded = [],
          promises = [];

      /**
       * Some times Ember puts some stuff in arrays. We want to clean it so
       * we know exactly what to iterate over.
       */
      for (var i in recordsArray) {
        if (recordsArray.hasOwnProperty(i)) {
          recordsToBeLoaded.push(recordsArray[i]);
        }
      }

      var loadNextRecord = function(record) {
        /**
         * Removes the first item from recordsToBeLoaded
         */
        recordsToBeLoaded = recordsToBeLoaded.slice(1);

        var promise = adapter.loadRelationships(store,type, record, relationships);

        promise.then(function(recordWithRelationships) {
          recordsWithRelationships.push(recordWithRelationships);

          if (recordsToBeLoaded[0]) {
            loadNextRecord(recordsToBeLoaded[0]);
          } else {
            resolve(recordsWithRelationships);
          }
        });
      }

      /**
       * We start by the first record
       */
      loadNextRecord(recordsToBeLoaded[0]);
    });
    // var adapter = this,
    //     records = [];

    // recordsArray.forEach(function(record) {
    //     records.push(adapter.loadRelationships(store, type, record));
    // });

    // return Ember.RSVP.resolve(records);
  },

  /**
   *
   * @method relationshipProperties
   * @private
   * @param {DS.Model} type
   * @param {String} relationName
   */
  relationshipProperties: function(type, relationName) {
    var relationships = Ember.get(type, 'relationshipsByName');
    if (relationName) {
      return relationships.get(relationName);
    } else {
      return relationships;
    }
  },

  /**
   * Some times, a payload has a reference for an association, like `comments`
   * below, but the actual record doesn't exist anymore.
   *
   *   payload = {
   *     id: "1",
   *     comments: ["2"],
   *     _embedded: {
   *     }
   *   };
   *
   * In this case, we should not return the `comments: ["2"]` relationship to
   * the serializer.
   *
   * @method cleanLostRelationshipsReferences
   * @private
   * @param {DS.Model} type
   * @param {Hash} payload
   */
  cleanLostRelationshipsReferences: function(store, type, payload) {
    var adapter = this;

    Ember.get(type, 'relationshipsByName').forEach(function(relationName, properties) {
      var NoEmbeddedRelations = function() {
        return !payload._embedded || !payload._embedded[relationName];
      }

      var IsLostRelationshipReference = function(id) {
        if (store.hasRecordForId(properties.type, id)) {
          return false;
        } else if(NoEmbeddedRelations()) {
          delete payload[relationName];
          return true;
        }
      }

      if (Ember.isArray(payload[relationName])) {
        payload[relationName] = payload[relationName].filter(function(id) {
          return !IsLostRelationshipReference(id);
        });
      } else if (payload[relationName]) {
        if (IsLostRelationshipReference(payload[relationName])) {
          payload[relationName] = null;
        }
      }
    });
  },
  willDestroypublic:function(){
    this.get("db").close();
  },
  allowRecursive:function(opts,isRecursive){
    if (opts && typeof opts.allowRecursive !== 'undefined') {
      return opts.allowRecursive||false;
    }else{
      return isRecursive||false;
    }
  },
  getRelationships:function(type,opts){
    if(opts && opts.preload && Ember.isArray(opts.preload)) return opts.preload;
    var relationshipNames = Ember.get(type, 'relationshipNames');
    return relationshipNames.belongsTo.concat(relationshipNames.hasMany);
  }
});
