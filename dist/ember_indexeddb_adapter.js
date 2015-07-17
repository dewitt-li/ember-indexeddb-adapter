DS.IndexedDBSerializer = DS.JSONSerializer.extend({
  serializeHasMany: function(snapshot, json, relationship) {
    var key = relationship.key;
    var payloadKey = this.keyForRelationship ? this.keyForRelationship(key, "hasMany") : key;
    var relationshipType = snapshot.type.determineRelationshipType(relationship);

    if (relationshipType === 'manyToNone' ||
        relationshipType === 'manyToMany' ||
        relationshipType === 'manyToOne') {
      //json[key] = record.get(key).mapBy('id');
        json[payloadKey] = snapshot.hasMany(key, { ids: true });
    // TODO support for polymorphic manyToNone and manyToMany relationships
    }
  },
  /**
   * Extracts whatever was returned from the adapter.
   *
   * If the adapter returns relationships in an embedded way, such as follows:
   *
   * ```js
   * {
   *   "id": 1,
   *   "title": "Rails Rambo",
   *
   *   "_embedded": {
   *     "comment": [{
   *       "id": 1,
   *       "comment_title": "FIRST"
   *     }, {
   *       "id": 2,
   *       "comment_title": "Rails is unagi"
   *     }]
   *   }
   * }
   *
   * this method will create separated JSON for each resource and then push
   * them individually to the Store.
   *
   * In the end, only the main resource will remain, containing the ids of its
   * relationships. Given the relations are already in the Store, we will
   * return a JSON with the main resource alone. The Store will sort out the
   * associations by itself.
   *
   * @method extractSingle
   * @private
   * @param {DS.Store} store the returned store
   * @param {DS.Model} type the type/model
   * @param {Object} payload returned JSON
   */
  extractSingle: function(store, type, payload) {
    if (payload && payload._embedded) {
      for (var relation in payload._embedded) {
        var relType = type.typeForRelationship(relation,store);
        var typeName = relType.modelName,
            embeddedPayload = payload._embedded[relation];

        if (embeddedPayload) {
          if (Ember.isArray(embeddedPayload)) {
            store.pushMany(typeName, embeddedPayload);
          } else {
            store.push(typeName, embeddedPayload);
          }
        }
      }

      delete payload._embedded;
    }

    return this.normalize(type, payload);
  },

  /**
   * This is exactly the same as extractSingle, but used in an array.
   *
   * @method extractSingle
   * @private
   * @param {DS.Store} store the returned store
   * @param {DS.Model} type the type/model
   * @param {Array} payload returned JSONs
   */
  extractArray: function(store, type, payload) {
    return payload.map(function(json) {
        return this.extractSingle(store, type, json);
      }, this);
    }
});
/*global Ember*/
/*global DS*/
'use strict';

/**
 * SmartSearch allows the adapter to make queries that are broader and that
 * will, in most business cases, yield more relevant results.
 *
 * It has a drawback, though: less performant queries. It shouldn't be a problem
 * for smaller data stores.
 */
DS.IndexedDBSmartSearch = Ember.Object.extend({

  field:       null,
  queryString: null,
  record:      null,
  type:        null,

  /**
   * The entrypoint. It tries to match the current query field against the
   * record. See below each query explained.
   *
   * == Search ==
   *
   *     store.findQuery('person', {search: "rao"})
   *
   * This will will search for any field that has the string rao, such as
   * "Rambo".
   *
   * == Search ==
   *
   *     store.findQuery('person', {createdAt: "32 days ago"})
   *
   * Given `createdAt` field has a transform type `date`, it will returns only
   * records that match the 32nd day ago.
   *
   * If the fields doesn't have the `date` transform, nothing is queried.
   *
   * Besides `x days ago`, `today` and `yesterday` are also accepted.
   */
  isMatch: function() {
    var record      = this.get('record'),
        type        = this.get('type'),
        field       = this.get('field'),
        queryString = this.get('queryString'),
        fieldType   = this.fieldType(field),
        queryType;

    if (fieldType === "search") {
      queryType = 'searchField';
    } else if (fieldType === "date") {
      queryType = 'dateField';
    } else {
      queryType = 'regularField';
    }

    return this[queryType](type, record, field, queryString);
  },

  /**
   * Searches for string in any field. Consider the following query:
   *
   *     store.findQuery('person', {search: "rmbo"})
   *
   * This would match a field such as `{name: "Rambo"}`.
   *
   * @method searchField
   */
  searchField: function(type, record, field, queryString) {
    var isMatch;

    for (var queriedField in record) {
      var isSearchField = this.get('fieldSearchCriteria')(queriedField, type),
          fieldValue = record[queriedField];

      if (!isSearchField)
        continue;

      if (!queryString || queryString == " ") { return false; }

      if (Object.prototype.toString.call(queryString).match("RegExp")) {
        isMatch = isMatch || new RegExp(queryString).test(fieldValue);
      } else {
        isMatch = isMatch || (fieldValue === queryString);

        var str,
            strArray = [];

        for (var i = 0, len = queryString.length; i < len; i++) {
          strArray.push(queryString[i]);
        }

        str = new RegExp(strArray.join(".*"), "i");
        isMatch = isMatch || new RegExp(str).test(fieldValue);
      }
    }

    return isMatch;
  },

  dateField: function(type, record, field, queryString) {
    var rawValue = record[field],
        date = (new Date(Date.parse(rawValue))),
        targetDate = new Date(),
        match;

    var IsMatchToDate = function(targetDate) {
      var year   = targetDate.getFullYear(),
          month  = targetDate.getMonth(),
          day    = targetDate.getDate(),
          hour   = targetDate.getHours(),
          minute = targetDate.getMinutes();

      if (date.getFullYear() == year &&
          date.getMonth()    == month &&
          date.getDate()     == day) {
        return true;
      }
    }

    if (queryString === "today") {
      if (IsMatchToDate(targetDate)) {
        return true;
      }
    } else if (queryString === "yesterday") {
      targetDate.setDate(targetDate.getDate() - 1);
      if (IsMatchToDate(targetDate)) {
        return true;
      }
    } else if (match = queryString.match(/([0-9]{1,}) days ago/i)) {
      targetDate.setDate(targetDate.getDate() - match[1]);
      if (IsMatchToDate(targetDate)) {
        return true;
      }
    }

    return false;
  },

  regularField: function(type, record, field, queryString) {
    var queriedField = record[field];

    if (Object.prototype.toString.call(queryString).match("RegExp")) {
      return new RegExp(queryString).test(queriedField);
    } else {
      return (queriedField === queryString);
    }
  },

  fieldType: function(fieldName) {
    if (fieldName === "search") {
      return "search";
    } else {
      var type = this.get('type'),
          transform;

      type.eachTransformedAttribute(function(name, type) {
        if (name == fieldName) {
          transform = type;
        }
      });

      return transform;
    }
  }
});

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
    return this.get("db")[type.modelName].get(id).then(function(record){
      if(record){
        if (allowRecursive) {
          return adapter.loadRelationships(type, record, opts&&opts.adapterOptions);
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
    return this.get("db")[type.modelName].where("id").anyOf(ids).toArray().then(function(records){
      if (allowRecursive) {
        return adapter.loadRelationshipsForMany(type, records, opts&&opts.adapterOptions);
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
    return this.get("db")[type.modelName].filter(function(value){
      for (var field in query) {
        if(query[field]!==value[field]){
          return false;
        }
      }
      return true;
    }).toArray()
    .then(function(records){
      return adapter.loadIdsForMany(store,type,records);
    })
    .then(function(records){
      return adapter.loadRelationshipsForMany(store, type, records);
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
    return this.get("db")[type.modelName].toArray().then(function(records){
      return adapter.loadRelationshipsForMany(store, type, records, opts&&opts.adapterOptions);
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
  loadIdsForMany: function(store, type, records){
    var relationshipNames = Ember.get(type, 'relationshipNames').hasMany;
    var adapter = this,
        recordsWithHasManyIds = [],
        promises = [],
        promise;
    records.forEach(function(record){
      promise = adapter.loadIds(store,type, record)
          .then(function(recordWithHasManyIds) {
            recordsWithHasManyIds.push(recordWithHasManyIds);
            return return Ember.RSVP.resolve();
          });
      promises.push(promise);
    });    
    
    return Ember.RSVP.all(promises).then(function() {
        return Ember.RSVP.resolve(recordsWithHasManyIds);
    });
  }
  loadIds: function(store, type, record){
    var relationshipNames = Ember.get(type, 'relationshipNames').hasMany;
    var relationshipsPromises=[];
    var tableName,columnName,promise;
    relationshipNames.forEach(function(relationshipName){
      tableName=this.relationshipProperties(type, relationshipName).kind.modelName;
      columnName=type.modelName.camelize();
      promise= this.get("db")[tableName].where(columnName).equals(record.id).keys().then(function(ids){
        record[relationshipName]=ids;
        return Ember.RSVP.resolve(records);
        });
      relationshipsPromises.push(promise);
    });

    return Ember.RSVP.all(relationshipsPromises).then(function() {
      return Ember.RSVP.resolve(record);
    });
  }
  loadRelationshipsForMany: function(store, type, records, options) {
    var adapter = this,
        recordsWithRelationships = [],
        promises = [],
        promise;
    records.forEach(function(record){
      promise = adapter.loadRelationships(store,type, record, options)
          .then(function(recordWithRelationships) {
            recordsWithRelationships.push(recordWithRelationships);
            return return Ember.RSVP.resolve();
          });
      promises.push(promise);
    });    
    
    return Ember.RSVP.all(promises).then(function() {
        return Ember.RSVP.resolve(recordsWithRelationships);
    });
  },

  loadRelationships: function(store, type, record,options) {
    var relationships=getRelationships(type,options);
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
      });
  },

  addEmbeddedPayload: function(payload, relationshipName, relationshipRecord) {
    if ((relationshipRecord && relationshipRecord.id)
      ||(relationshipRecord && relationshipRecord.length && relationshipRecord.isEvery("id")) {
        payload['_embedded'] = payload['_embedded']||{};
        payload['_embedded'][relationshipName] = relationshipRecord;
    }
    return payload;
  },


  relationshipProperties: function(type, relationName) {
    var relationships = Ember.get(type, 'relationshipsByName');
    if (relationName) {
      return relationships.get(relationName);
    } else {
      return relationships;
    }
  },

  willDestroy:function(){
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
    var preloadFields=opts && opts.preload && Ember.isArray(opts.preload) && opts.preload ||[];
    return type.relationshipNames.filter(function(relationshipName){
      return type.relationshipsByName[relationshipName].options && !type.relationshipsByName[relationshipName].options.async
        ||preloadFields.indexOf(relationshipName);
    });
  }
});
