import * as $ from 'jquery';

import { DataProvider, FilterParams } from '../provider';
import { Dictionary, ClassModel, LinkType, ElementModel, LinkModel, LinkCount, PropertyModel } from '../model';
import {
    getClassTree,
    getClassInfo,
    getLinkTypes,
    getElementsInfo,
    getLinksInfo,
    getLinksTypesOf,
    getFilteredData,
    getEnrichedElementsInfo,
    getLinkTypesInfo,
    getPropertyInfo,
} from './responseHandler';
import {
    ClassBinding, ElementBinding, LinkBinding,
    LinkTypeBinding, LinkTypeInfoBinding, ElementImageBinding,
    PropertyBinding,
} from './sparqlModels';
import {SparqlDataProviderOptions, executeSparqlQuery} from "./sparqlDataProvider";

const DEFAULT_PREFIX =
`PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
 PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
 PREFIX owl:  <http://www.w3.org/2002/07/owl#>` + '\n\n';



export class SparqlStatsDataProvider implements DataProvider {
    constructor(private options: SparqlDataProviderOptions) {}

    classTree(): Promise<ClassModel[]> {
        const query = DEFAULT_PREFIX + `
            SELECT ?class ?instcount ?label ?parent
            WHERE {
                {{
                    SELECT ?class (count(?inst) as ?instcount)
                    WHERE {
                        ?inst a ?class.
                    }
                    GROUP BY ?class
                }} UNION {
                    ?class a owl:Class
                } UNION {
                    ?class a rdfs:Class
                }                
                OPTIONAL { ?class rdfs:label ?label.}
                OPTIONAL {?class rdfs:subClassOf ?parent}
            }
        `;
        return executeSparqlQuery<ClassBinding>(
            this.options.endpointUrl, query).then(getClassTree);
    }

    propertyInfo(params: { propertyIds: string[] }): Promise<Dictionary<PropertyModel>> {
        const ids = params.propertyIds.map(escapeIri).map(id => ` ( ${id} )`).join(' ');
        const query = DEFAULT_PREFIX + `
            SELECT ?prop ?label
            WHERE {
                ?prop rdfs:label ?label.
                VALUES (?prop) {${ids}}.
            }
        `;
        return executeSparqlQuery<PropertyBinding>(
            this.options.endpointUrl, query).then(getPropertyInfo);
    }

    classInfo(params: {classIds: string[]}): Promise<ClassModel[]> {
        const ids = params.classIds.map(escapeIri).map(id => ` ( ${id} )`).join(' ');
        const query = DEFAULT_PREFIX + `
            SELECT ?class ?label ?instcount
            WHERE {
                ?class rdfs:label ?label.
                VALUES (?class) {${ids}}.
                BIND("" as ?instcount)
            }
        `;
        return executeSparqlQuery<ClassBinding>(
            this.options.endpointUrl, query).then(getClassInfo);
    }

    linkTypesInfo(params: {linkTypeIds: string[]}): Promise<LinkType[]> {
        const ids = params.linkTypeIds.map(escapeIri).map(id => ` ( ${id} )`).join(' ');
        const query = DEFAULT_PREFIX + `
            SELECT ?type ?label ?instcount
            WHERE {
                ?type rdfs:label ?label.
                VALUES (?type) {${ids}}.
                BIND("" as ?instcount)      
            }
        `;
        return executeSparqlQuery<LinkTypeInfoBinding>(
            this.options.endpointUrl, query).then(getLinkTypesInfo);
    }

    linkTypes(): Promise<LinkType[]> {
        const query = DEFAULT_PREFIX + `
            SELECT ?link ?instcount ?label
            WHERE {
                {{
                    SELECT ?link (count(?link) as ?instcount)
                    WHERE {
                        [] ?link ?obj.
                        filter (IsIRI(?obj))
                    }
                    GROUP BY ?link
                }} UNION {
                    ?link a owl:ObjectProperty
                }
                OPTIONAL {?link rdfs:label ?label}
            }
        `;
        return executeSparqlQuery<LinkTypeBinding>(
            this.options.endpointUrl, query).then(getLinkTypes);
    }

    elementInfo(params: { elementIds: string[]; }): Promise<Dictionary<ElementModel>> {
        const ids = params.elementIds.map(escapeIri).map(id => ` (${id})`).join(' ');
        const query = DEFAULT_PREFIX + `
            SELECT ?inst ?class ?label ?propType ?propValue
            WHERE {
                OPTIONAL {?inst rdf:type ?class . }
                OPTIONAL {?inst rdfs:label ?label}
                OPTIONAL {?inst ?propType ?propValue.
                FILTER (isLiteral(?propValue)) }
            } VALUES (?inst) {${ids}}
        `;
        return executeSparqlQuery<ElementBinding>(this.options.endpointUrl, query)
            .then(elementsInfo => getElementsInfo(elementsInfo, params.elementIds))
            .then(elementsInfo => {
                if (this.options.prepareImages) {
                    return this.prepareElementsImage(elementsInfo);
                } else if (this.options.imageClassUris && this.options.imageClassUris.length) {
                    return this.enrichedElementsInfo(elementsInfo, this.options.imageClassUris);
                } else {
                    return elementsInfo;
                }
            });
    }

    private enrichedElementsInfo(
        elementsInfo: Dictionary<ElementModel>,
        types: string[]
    ): Promise<Dictionary<ElementModel>> {
        const ids = Object.keys(elementsInfo).map(escapeIri).map(id => ` ( ${id} )`).join(' ');
        const typesString = types.map(escapeIri).map(id => ` ( ${id} )`).join(' ');

        const query = DEFAULT_PREFIX + `
            SELECT ?inst ?linkType ?image
            WHERE {{
                VALUES (?inst) {${ids}}
                VALUES (?linkType) {${typesString}} 
                ?inst ?linkType ?image
            }}
        `;
        return executeSparqlQuery<ElementImageBinding>(this.options.endpointUrl, query)
            .then(imageResponce => getEnrichedElementsInfo(imageResponce, elementsInfo)).catch((err) => {
                console.log(err);
                return elementsInfo;
            });
    }

    private prepareElementsImage(
        elementsInfo: Dictionary<ElementModel>
    ): Promise<Dictionary<ElementModel>> {
        return this.options.prepareImages(elementsInfo).then(images => {
            for (const key in images) {
                if (images.hasOwnProperty(key) && elementsInfo[key]) {
                    elementsInfo[key].image = images[key];
                }
            }
            return elementsInfo;
        });
    }

    linksInfo(params: {
        elementIds: string[];
        linkTypeIds: string[];
    }): Promise<LinkModel[]> {
        const ids = params.elementIds.map(escapeIri).map(id => ` ( ${id} )`).join(' ');
        //skip for now
        //const types = params.linkTypeIds.map(escapeIri).join(', ');
        const query = DEFAULT_PREFIX + `
            SELECT ?source ?type ?target
            WHERE {
                ?source ?type ?target.
                VALUES (?source) {${ids}}
                VALUES (?target) {${ids}}
            }
        `;
        return executeSparqlQuery<LinkBinding>(
            this.options.endpointUrl, query).then(getLinksInfo);
    }

    linkTypesOf(params: { elementId: string; }): Promise<LinkCount[]> {
        const query = DEFAULT_PREFIX + `
            SELECT ?link (count(?link) as ?instcount)
            WHERE {{
                ${escapeIri(params.elementId)} ?link ?obj.
                FILTER (IsIRI(?obj)) 
            } UNION {
                [] ?link ${escapeIri(params.elementId)}.
            }} GROUP BY ?link
        `;

        return executeSparqlQuery<LinkTypeBinding>(this.options.endpointUrl, query).then(getLinksTypesOf);
    };

    filter(params: FilterParams): Promise<Dictionary<ElementModel>> {
        if (params.limit === 0) { params.limit = 100; }

        let refQueryPart = '';
        if (params.refElementId && params.refElementLinkId) {
            refQueryPart =  `{
                ${escapeIri(params.refElementId)} ${escapeIri(params.refElementLinkId)} ?inst .
                } UNION {
                    ?inst ${escapeIri(params.refElementLinkId)} ${escapeIri(params.refElementId)} .
                }`;
        }

        if (params.refElementId && !params.refElementLinkId) {
            refQueryPart = `{
                ${escapeIri(params.refElementId)} ?p ?inst .
                } UNION {
                    ?inst ?p ${escapeIri(params.refElementId)} .
                }`;
        }

        if (!params.refElementId && params.refElementLinkId) {
            throw new Error(`Can't execute refElementLink filter without refElement`);
        }

        const elementTypePart = params.elementTypeId
            ? `?inst rdf:type ${escapeIri(params.elementTypeId)} . ${'\n'}` : '';
        const textSearchPart = params.text ? (
            ' OPTIONAL {?inst rdfs:label ?search1} \n' +
            ' FILTER regex(COALESCE(str(?search1), str(?extractedLabel)), "' + params.text + '", "i")\n') : '';
        let query = DEFAULT_PREFIX + `
            SELECT ?inst ?class ?label
            WHERE {
                {
                    SELECT distinct ?inst WHERE {
                        ${elementTypePart}
                        ${refQueryPart}
                        ${textSearchPart}
                    } ORDER BY ?sortLabel LIMIT ${params.limit} OFFSET ${params.offset}
                }
                OPTIONAL {?inst rdf:type ?foundClass}
                BIND (coalesce(?foundClass, owl:Thing) as ?class)
                OPTIONAL {?inst rdfs:label ?label}
                OPTIONAL {?inst rdfs:label ?label1. 
                    FILTER (langmatches(lang(?label1), "` + params.languageCode + `"))}
                OPTIONAL {?inst rdfs:label ?label2. 
                    FILTER (langmatches(lang(?label2), ""))}
                    ${sparqlExtractLabel('?inst', '?extractedLabel')}
                BIND (coalesce (?label1, ?label2, ?extractedLabel) as ?sortLabel)
            }
        `;

        return executeSparqlQuery<ElementBinding>(
            this.options.endpointUrl, query).then(getFilteredData);
    };
};

function escapeIri(iri: string) {
    return `<${iri}>`;
}

export function sparqlExtractLabel(subject: string, label: string): string {
    return  `
        BIND ( str( ${subject} ) as ?uriStr)
        BIND ( strafter(?uriStr, "#") as ?label3)
        BIND ( strafter(strafter(?uriStr, "//"), "/") as ?label6) 
        BIND ( strafter(?label6, "/") as ?label5)   
        BIND ( strafter(?label5, "/") as ?label4)   
        BIND (if (?label3 != "", ?label3, 
            if (?label4 != "", ?label4, 
            if (?label5 != "", ?label5, ?label6))) as ${label})
    `;
};



export default SparqlStatsDataProvider;