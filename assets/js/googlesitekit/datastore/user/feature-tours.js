/**
 * `core/user` data store: feature tours
 *
 * Site Kit by Google, Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * External dependencies
 */
import compareVersions from 'compare-versions';
import invariant from 'invariant';

/**
 * Internal dependencies
 */
import API from 'googlesitekit-api';
import Data from 'googlesitekit-data';
import { createFetchStore } from '../../data/create-fetch-store';
import { STORE_NAME } from './constants';
import featureTours from '../../../feature-tours';
const { createRegistrySelector, createRegistryControl } = Data;
const { getRegistry } = Data.commonActions;

// Actions.
const DISMISS_TOUR = 'DISMISS_TOUR';
const RECEIVE_READY_TOURS = 'RECEIVE_READY_TOURS';
const RECEIVE_TOURS = 'RECEIVE_TOURS';
const CHECK_TOUR_REQUIREMENTS = 'CHECK_TOUR_REQUIREMENTS';

const fetchGetDismissedToursStore = createFetchStore( {
	baseName: 'getDismissedTours',
	controlCallback: () => {
		return API.get( 'core', 'user', 'dismissed-tours', {}, { useCache: false } );
	},
	reducerCallback: ( state, dismissedTourSlugs ) => {
		return {
			...state,
			dismissedTourSlugs,
		};
	},
} );
const { fetchGetDismissedTours } = fetchGetDismissedToursStore.actions;
const fetchDismissTourStore = createFetchStore( {
	baseName: 'dismissTour',
	controlCallback: ( { slug } ) => API.set( 'core', 'user', 'dismiss-tour', { slug } ),
	reducerCallback: ( state, dismissedTourSlugs ) => {
		return {
			...state,
			dismissedTourSlugs,
		};
	},
	argsToParams: ( slug ) => ( { slug } ),
	validateParams: ( { slug } = {} ) => {
		invariant( slug, 'slug is required.' );
	},
} );
const { fetchDismissTour } = fetchDismissTourStore.actions;

const baseInitialState = {
	// Array of dismissed tour slugs.
	dismissedTourSlugs: undefined,
	// Array of tour objects.
	tours: featureTours,
	// Map of [viewContext]: ordered array of tour objects.
	viewTours: {},
};

const baseActions = {
	/**
	 * Dismisses the given tour by slug.
	 *
	 * @since 1.27.0
	 *
	 * @param {string} slug Tour slug to dismiss.
	 * @return {Object} Generator instance.
	 */
	dismissTour( slug ) {
		invariant( slug, 'A tour slug is required to dismiss a tour.' );

		return ( function* () {
			const { select } = yield getRegistry();
			if ( select( STORE_NAME ).isFetchingDismissTour( slug ) ) {
				const response = select( STORE_NAME ).getDismissedFeatureTourSlugs();
				return { response, error: undefined };
			}
			// Dismiss the given tour immediately.
			yield {
				payload: { slug },
				type: DISMISS_TOUR,
			};
			// Dispatch a request to persist and receive updated dismissed tours.
			return yield fetchDismissTour( slug );
		}() );
	},

	receiveFeatureToursForView( viewTours, { viewContext } = {} ) {
		invariant( Array.isArray( viewTours ), 'viewTours must be an array.' );
		invariant( viewContext, 'viewContext is required.' );
		return {
			payload: { viewTours, viewContext },
			type: RECEIVE_READY_TOURS,
		};
	},

	receiveAllFeatureTours( tours ) {
		invariant( Array.isArray( tours ), 'tours must be an array.' );
		return {
			payload: { tours },
			type: RECEIVE_TOURS,
		};
	},
};

const baseControls = {
	[ CHECK_TOUR_REQUIREMENTS ]: createRegistryControl( ( registry ) => async ( { payload } ) => {
		const { tour, viewContext } = payload;
		// Check the view context.
		if ( ! tour.contexts.includes( viewContext ) ) {
			return false;
		}

		// Only tours with a version after a user's initial Site Kit version should qualify.
		const initialVersion = registry.select( STORE_NAME ).getInitialSiteKitVersion();
		if ( ! initialVersion ) {
			return false;
		} else if ( compareVersions.compare( initialVersion, tour.version, '>=' ) ) {
			return false;
		}

		// Check if the tour has already been dismissed.
		// Here we need to first await the underlying selector with the asynchronous resolver.
		await registry.__experimentalResolveSelect( STORE_NAME ).getDismissedFeatureTourSlugs();
		if ( registry.select( STORE_NAME ).isTourDismissed( tour.slug ) ) {
			return false;
		}

		// If the tour has additional requirements, check those as well.
		if ( tour.checkRequirements ) {
			return !! await tour.checkRequirements( registry );
		}

		return true;
	} ),
};

const baseReducer = ( state, { type, payload } ) => {
	switch ( type ) {
		case DISMISS_TOUR: {
			const { slug } = payload;
			const { dismissedTourSlugs = [] } = state;
			if ( dismissedTourSlugs.includes( slug ) ) {
				return state;
			}
			return {
				...state,
				dismissedTourSlugs: dismissedTourSlugs.concat( slug ),
			};
		}

		case RECEIVE_READY_TOURS: {
			const { viewContext, viewTours } = payload;
			return {
				...state,
				viewTours: {
					...state.viewTours,
					[ viewContext ]: viewTours,
				},
			};
		}

		case RECEIVE_TOURS: {
			return {
				...state,
				tours: payload.tours,
			};
		}

		default: {
			return state;
		}
	}
};

const baseResolvers = {
	*getDismissedFeatureTourSlugs() {
		const { select } = yield getRegistry();
		if ( ! select( STORE_NAME ).getDismissedFeatureTourSlugs() ) {
			yield fetchGetDismissedTours();
		}
	},

	*getFeatureToursForView( viewContext ) {
		const registry = yield getRegistry();
		const tours = registry.select( STORE_NAME ).getAllFeatureTours();
		const viewTours = [];

		for ( const tour of tours ) {
			const tourQualifies = yield {
				payload: { tour, viewContext },
				type: CHECK_TOUR_REQUIREMENTS,
			};

			if ( tourQualifies ) {
				viewTours.push( tour );
			}
		}
		yield actions.receiveFeatureToursForView( viewTours, { viewContext } );
	},
};

const baseSelectors = {
	/**
	 * Gets the list of dismissed tour slugs.
	 *
	 * @since 1.27.0
	 * @since n.e.x.t Renamed from getDismissedTours.
	 * @private
	 *
	 * @param {Object} state Data store's state.
	 * @return {(string[]|undefined)} Array of dismissed tour slugs,
	 *                                `undefined` if not resolved yet.
	 */
	getDismissedFeatureTourSlugs( state ) {
		return state.dismissedTourSlugs;
	},

	/**
	 * Gets a list of tour objects that qualify for the given view context.
	 *
	 * @since n.e.x.t
	 *
	 * @param {Object} state       Data store's state.
	 * @param {string} viewContext View context.
	 * @return {(Object[]|undefined)} Array of qualifying tour objects
	 *                                `undefined` while readiness is being resolved.
	 */
	getFeatureToursForView( state, viewContext ) {
		return state.viewTours[ viewContext ];
	},

	/**
	 * Gets a list of all tour objects.
	 *
	 * @since n.e.x.t
	 * @private
	 *
	 * @param {Object} state Data store's state.
	 * @return {Object[]} Array of tour objects.
	 */
	getAllFeatureTours( state ) {
		return state.tours;
	},

	/**
	 * Checks whether or not the given tour is dismissed.
	 *
	 * @since 1.27.0
	 *
	 * @param {Object} state Data store's state.
	 * @param {string} slug  Tour slug to check.
	 * @return {(boolean|undefined)} `undefined` if dismissed tours are not loaded yet,
	 *                               `true` if dismissed,
	 *                               `false` if not dismissed.
	 */
	isTourDismissed: createRegistrySelector( ( select ) => ( state, slug ) => {
		const dismissedTourSlugs = select( STORE_NAME ).getDismissedFeatureTourSlugs();

		if ( undefined === dismissedTourSlugs ) {
			return undefined;
		}

		return dismissedTourSlugs.includes( slug );
	} ),
};

export const {
	actions,
	controls,
	initialState,
	reducer,
	resolvers,
	selectors,
} = Data.combineStores(
	{
		initialState: baseInitialState,
		actions: baseActions,
		controls: baseControls,
		reducer: baseReducer,
		resolvers: baseResolvers,
		selectors: baseSelectors,
	},
	fetchDismissTourStore,
	fetchGetDismissedToursStore,
);

export default {
	actions,
	controls,
	initialState,
	reducer,
	resolvers,
	selectors,
};
