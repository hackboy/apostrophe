// `apostrophe-pieces-pages` implements "index pages" that display pieces of a
// particular type in a paginated, filterable way. It's great for implementing
// blogs, event listings, project listings, staff directories... almost any
// content type.
//
// You will `extend` this module in new modules corresponding to your modules
// that extend `apostrophe-pieces`.
//
// To learn more and see complete examples, see:
//
// [Reusable content with pieces](../../tutorials/getting-started/reusable-content-with-pieces.html)

var _ = require('lodash');
var async = require('async');

module.exports = {
  extend: 'apostrophe-custom-pages',

  afterConstruct: function(self) {
    self.dispatchAll();
    self.enableAddUrlsToPieces();
  },

  construct: function(self, options) {
    self.options.addFields = [
      {
        type: 'tags',
        name: 'withTags',
        label: 'Show Content With These Tags'
      }
    ].concat(self.options.addFields || []);
    self.label = self.options.label;
    self.perPage = options.perPage || 10;

    self.piecesModuleName = self.options.piecesModuleName || self.__meta.name.replace(/\-pages$/, '');
    self.pieces = self.apos.modules[self.piecesModuleName];
    self.piecesCssName = self.apos.utils.cssName(self.pieces.name);

    self.contextMenu = options.contextMenu || [
      {
        action: 'create-' + self.piecesCssName,
        label: 'Create ' + self.pieces.label
      },
      {
        action: 'edit-' + self.piecesCssName,
        label: 'Update ' + self.pieces.label,
        value: true
      },
      {
        action: 'manage-' + self.piecesCssName,
        label: 'Manage ' + self.pieces.pluralLabel
      },
      {
        action: 'versions-' + self.piecesCssName,
        label: self.pieces.label + ' Versions',
        value: true
      },
      {
        action: 'trash-' + self.piecesCssName,
        label: 'Trash ' + self.pieces.label,
        value: true
      }
    ];

    self.publishMenu = options.publishMenu || [
      {
        action: 'publish-' + self.piecesCssName,
        label: 'Publish ' + self.pieces.label,
        value: true
      },
    ];

    // Extend this method for your piece type to call additional
    // chainable filters by default. You should not add entirely new
    // filters here. For that, define the appropriate subclass of
    // `apostrophe-pieces-cursor` in your subclass of
    // `apostrophe-pieces`.

    self.indexCursor = function(req) {
      return self.pieces.find(req, {})
        .queryToFilters(req.query, 'public')
        .perPage(self.perPage);
    };

    // At the URL of the page, display an index view (list view) of
    // the pieces, with support for pagination.

    self.indexPage = function(req, callback) {

      if (self.pieces.contextual) {
        req.contextMenu = _.filter(self.contextMenu, function(item) {
          // Items specific to a particular piece don't make sense
          // on the index page
          return !item.value;
          // Add the standard items, they have to be available sometime
          // when working with an index page
        }).concat(self.apos.pages.options.contextMenu);
        req.publishMenu = _.filter(self.publishMenu, function(item) {
          // Items specific to a particular piece don't make sense
          // on the index page
          return !item.value;
        });
      }

      var cursor = self.indexCursor(req);

      self.filterByIndexPageTags(cursor, req.data.page);

      function totalPieces(callback) {
        cursor.toCount(function(err, count) {
          if (err) {
            return callback(err);
          }
          if (cursor.get('page') > cursor.get('totalPages')) {
            req.notFound = true;
            return callback(null);
          }
          req.data.totalPieces = count;
          req.data.totalPages = cursor.get('totalPages');
          return callback();
        });
      };

      function findPieces(callback) {
        cursor.toArray(function(err, docs) {
          if (err) {
            return callback(err);
          }
          if (self.apos.utils.isAjaxRequest(req)) {
            req.template = self.renderer('indexAjax');
          } else {
            req.template = self.renderer('index');
          }
          req.data.currentPage = cursor.get('page');
          req.data.pieces = docs;
          return callback();
        });
      }

      return async.series([totalPieces, findPieces], function(err) {
        return self.beforeIndex(req, callback);
      });
    }

    // Called before `indexPage`. By default, does nothing.
    // A convenient way to extend the functionality.

    self.beforeIndex = function(req, callback) {
      return setImmediate(callback);
    }

    // Invokes filters on the given cursor to ensure it only fetches
    // results with the tags this page has been locked down to via
    // page settings. If it has not been locked down, no filtering occurs.
    // Override to change the behavior.

    self.filterByIndexPageTags = function(cursor, page) {
      if (page.withTags && page.withTags.length) {
        cursor.and({ tags: { $in: page.withTags } });
      }
    };

    // Invoked to display a piece by itself, a "show page." Renders
    // the `show.html` template after setting `data.piece`.
    //
    // If the pieces module is set `contextual: true`, the context menu
    // (the gear at lower left) is updated appropriately if the user has
    // editing permissions.

    self.showPage = function(req, callback) {

      // We'll try to find the piece as an ordinary reader and, if the piece type
      // is contextual, we'll also try it as an editor if needed

      var doc;
      return async.series([
        findAsReader,
        findAsEditor
      ], function(err) {
        if (err) {
          return callback(err);
        }
        if (!doc) {
          req.notFound = true;
          return callback(null);
        }
        if (self.pieces.contextual) {
          req.contextMenu = _.map(self.contextMenu, function(item) {
            if (item.value) {
              // Don't modify a shared item, race conditions
              // could give us the wrong ids
              item = _.clone(item);
              item.value = doc._id;
            }
            return item;
          });
          req.publishMenu = _.map(self.publishMenu, function(item) {
            if (item.value) {
              // Don't modify a shared item, race conditions
              // could give us the wrong ids
              item = _.clone(item);
              item.value = doc._id;
            }
            return item;
          });
        }
        req.template = self.renderer('show');
        req.data.piece = doc;
        return self.beforeShow(req, callback);
      });

      function findAsReader(callback) {
        var cursor = self.pieces.find(req, { slug: req.params.slug });
        return cursor.toObject(function(err, _doc) {
          if (err) {
            return callback(err);
          }
          doc = _doc;
          return callback(null);
        });
      }

      function findAsEditor(callback) {
        if (doc || (!req.user) || (!self.pieces.contextual)) {
          return callback(null);
        }
        // Use findForEditing to allow subclasses to extend the set of filters that
        // don't apply by default in an editing context. -Tom
        var cursor = self.pieces.findForEditing(req, { slug: req.params.slug });
        return cursor.toObject(function(err, _doc) {
          if (err) {
            return callback(err);
          }
          doc = _doc;
          return callback(null);
        });
      }

    };

    // Invoked just before the piece is displayed on its "show page." By default,
    // does nothing. A useful override point.

    self.beforeShow = function(req, callback) {
      return setImmediate(callback);
    };

    // Set the dispatch routes. By default, the bare URL of the page displays
    // the index view via `indexPage`; if the URL has an additional component,
    // e.g. `/blog/good-article`, it is assumed to be the slug of the
    // article and `showPage` is invoked. You can override this method,
    // for instance to also accept `/:year/:month/:day/:slug` as a way of
    // invoking `self.showPage`. See [apostrophe-custom-pages](../apostrophe-custom-pages/index.html)
    // for more about what you can do with dispatch routes.

    self.dispatchAll = function() {
      self.dispatch('/', self.indexPage);
      self.dispatch('/:slug', self.showPage);
    };

    // Given an array containing all of the index pages of this type that
    // exist on the site and an individual piece, return the
    // index page that is the best fit for use in the URL of
    // the piece. The algorithm is based on shared tags, with
    // an emphasis on matching tags, and also favors an index
    // page with no preferred tags over bad matches. Override to
    // replace the algorithm.
    //
    // This method is called for you. In the presence of index pages, the
    // cursors for the corresponding pieces are automatically enhanced to
    // invoke it when building URLs.

    self.chooseParentPage = function(pages, piece) {
      var property = self.options.chooseParentPageBy || 'tags';
      // The "tags" property was moved to "withTags" to distinguish
      // what a page *shows* from what a page *is*
      var pageProperty = (property === 'tags') ? 'withTags' : property;
      var tags = piece[property] || [];
      var bestScore;
      var best = null;
      _.each(pages, function(page) {
        var score = 0;
        var pageTags = page[pageProperty] ? page[pageProperty] : [];
        if (!pageTags.length) {
          score = 1;
        }
        var intersect = _.intersection(tags, pageTags);
        var diff = _.difference(tags, pageTags);
        score += intersect.length * 2 - diff.length;
        if ((!best) || (score > bestScore)) {
          bestScore = score;
          best = page;
        }
      });
      return best;
    };

    // Given an index page and a piece, build a complete URL to
    // the piece. If you override `dispatch` to change how
    // "show page" URLs are matched, you will also want to override
    // this method to build them differently.

    self.buildUrl = function(page, piece) {
      if (!page) {
        return false;
      }
      return page._url + '/' + piece.slug;
    };

    // Make the browser-side `apos` object aware of the current
    // in-context piece, as `apos.contextPiece`. Just enough to
    // help the contextual editing tools in various modules

    self.pushContextPiece = function(req) {
      if (self.pieces.options.contextual && req.data.piece) {
        req.browserCall('apos.contextPiece = ?', _.pick(req.data.piece, '_id', 'title', 'slug', 'type'));
      }
    };

    var superPageBeforeSend = self.pageBeforeSend;

    // Calls `pushContextPiece` to make `apos.contextPiece` available
    // in the browser

    self.pageBeforeSend = function(req) {
      self.pushContextPiece(req);
      return superPageBeforeSend(req);
    }

    // Adds the `._url` property to all of the provided pieces,
    // which are assumed to be of the appropriate type for this module.
    // Aliased as the `addUrls` method of [apostrophe-pieces](../apostrophe-pieces/index.html), which
    // is invoked by the `addUrls` filter of [apostrophe-cursor](../apostrophe-docs/server-apostrophe-cursor.html).

    self.addUrlsToPieces = function(req, results, callback) {
      var pieceName = self.pieces.name;
      return async.series({
        getIndexPages: function(callback) {
          if (req.aposParentPageCache && req.aposParentPageCache[pieceName]) {
            return setImmediate(callback);
          }
          return self.findForAddUrlsToPieces(req)
            .toArray(function(err, pages) {
              if (err) {
                return callback(err);
              }
              if (!req.aposParentPageCache) {
                req.aposParentPageCache = {};
              }
              req.aposParentPageCache[pieceName] = pages;
              return callback(null);
            }
          );
        }
      }, function(err) {
        _.each(results, function(piece) {
          var parentPage = self.chooseParentPage(req.aposParentPageCache[pieceName], piece);
          if (parentPage) {
            piece._url = self.buildUrl(parentPage, piece);
            piece._parentUrl = parentPage._url;
          }
        });
        return callback(null);
      });
    };

    // Returns a cursor suitable for finding pieces-pages for the
    // purposes of assigning URLs to pieces based on the best match.
    //
    // Should be as fast as possible while still returning enough
    // information to do that. For instance, tags are essential for the standard
    // `chooseParentPage` algorithm, but joins and areas are not.
    //
    // The default implementation returns a cursor with areas
    // and joins shut off.

    self.findForAddUrlsToPieces = function(req) {
      return self.find(req)
        .areas(false)
        .joins(false);
    };

    // Configure our `addUrlsToPieces` method as the `addUrls` method
    // of the related pieces module.

    self.enableAddUrlsToPieces = function() {
      self.pieces.setAddUrls(self.addUrlsToPieces);
    };

  }
};
