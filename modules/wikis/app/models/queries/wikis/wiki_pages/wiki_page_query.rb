# frozen_string_literal: true

#-- copyright
# OpenProject is an open source project management software.
# Copyright (C) the OpenProject GmbH
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License version 3.
#
# OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
# Copyright (C) 2006-2013 Jean-Philippe Lang
# Copyright (C) 2010-2013 the ChiliProject Team
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License
# as published by the Free Software Foundation; either version 2
# of the License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
#
# See COPYRIGHT and LICENSE files for more details.
#++

module Queries
  module Wikis
    module WikiPages
      class WikiPageQuery
        include BaseQuery
        include UnpersistedQuery

        MAIN = "main"
        ALL = "all"
        STATIC_QUERIES = [MAIN, ALL].freeze
        DEFAULT_QUERY = MAIN

        def self.normalized_query_id(value)
          value = value.to_s
          STATIC_QUERIES.include?(value) ? value : DEFAULT_QUERY
        end

        def self.static_queries
          STATIC_QUERIES.map do |query_id|
            new.tap { |query| query.query_id = query_id }
          end
        end

        def query_id
          @query_id || DEFAULT_QUERY
        end

        def query_id=(value)
          @query_id = self.class.normalized_query_id(value)
        end

        def name
          I18n.t("wikis.index.queries.#{query_id}")
        end

        def default_scope
          scope = ::WikiPage
                    .joins(wiki: :project)
                    .merge(::Project.allowed_to(::User.current, :view_wiki_pages))
                    .order(updated_at: :desc)
          scope = scope.where(parent_id: nil) if query_id == MAIN
          scope
        end
      end
    end
  end
end
